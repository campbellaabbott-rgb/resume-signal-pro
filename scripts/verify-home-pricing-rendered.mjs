// THE RENDERED HOMEPAGE AND PRICING PAGE, FOR VERIFY SECTION 99 (C8, C9).
//
// The crawler claims of section 99 read the baked HTML. These two read what a
// visitor's browser renders, header and footer included: React replaces the
// baked page, and the shared chrome (the Header, the Footer) is React's.
//
//   C8  "/#upload" lands on /resume-checker at its uploader (the scanner scrolls
//       to #upload and then clears the hash from the address, as it always
//       has), and /resume-checker still renders the scanner's uploader.
//       The addresses mail already sent and affiliates carry reach it too, the
//       query kept: a scan report's rescan link and "/?ref=<a 12-hex code>";
//       a directory's own "/?ref=producthunt" stays on "/".
//   C9  The rendered "/" and "/pricing" name no cut product anywhere we write
//       (Freelance Boost, Transition Pro, Premium, Scan Pack, "unlimited"; the
//       live postings, employers' own words, are left out), and carry exactly
//       one filled button across the header and main.
//   C12 A fresh load of "/pricing#pro" (the JSON-LD Offer.url's address)
//       lands with the Pro card's top inside the first screen, below the
//       header (review round 2026-10-26: it ended at the footer).
//
// READ-ONLY. One headless Chromium, closed in a finally. Every request that is
// not a GET, HEAD or OPTIONS is answered inside the browser, except an RPC
// (re-sent as a GET, which PostgREST runs in a read-only transaction) and a
// job-board list or detail read (sent with x-rb-budget: probe). So the pages'
// analytics, and anything else that writes, reach nothing.
//
// judgeRendered is pure, so a test can prove each line can PASS, FAIL and
// INFO without a browser.
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CUT_PATTERN = /Freelance Boost|Transition Pro|\bPremium\b|Scan Pack|\bunlimited\b/gi;

/** A code in an affiliate's shape that no affiliate holds, so its click is nobody's. */
export const AFFILIATE_PROBE = "000000000000";

/** The query-carrying addresses C8 opens, and where each must land. */
export const C8_ADDRESSES = [
  { from: "/?utm_source=email&utm_medium=scan_report&utm_campaign=rescan", want: "scanner" },
  { from: `/?ref=${AFFILIATE_PROBE}`, want: "scanner" },
  { from: "/?ref=producthunt", want: "home" },
];

/**
 * The verdict lines for what the browser saw. `facts` (null when a page could
 * not be read):
 *   upload:  { finalUrl, uploaderInView }
 *   checker: { hasUploader }
 *   home, pricing: { rendered, leaks: string[], filledHeader: string[], filledMain: string[] }
 *   addresses: [{ from, want: "scanner" | "home", finalUrl }]  (C8_ADDRESSES as opened)
 *   fragment: { top, headerBottom, innerHeight }  ("/pricing#pro" after it settled)
 */
export function judgeRendered(facts) {
  const out = [];
  const line = (s, m) => out.push(`${s.padEnd(5)} ${m}`);
  const up = facts?.upload;
  if (!up) line("FAIL", "C8 \"/#upload\" could not be opened in the browser");
  else {
    const where = up.finalUrl.replace(/^https?:\/\/[^/]+/, "") || "(nothing)";
    const onScanner = /^\/resume-checker(?:[?#]|$)/.test(where);
    const atUploader = /#upload$/.test(where) || up.uploaderInView === true;
    line(onScanner && atUploader ? "PASS" : "FAIL", `C8 "/#upload" lands on ${where}${onScanner ? (atUploader ? (up.uploaderInView ? ", the uploader in view" : "") : ", but not at the uploader") : " (want /resume-checker at its uploader)"}`);
  }
  const ck = facts?.checker;
  if (!ck) line("FAIL", "C8 /resume-checker could not be opened in the browser");
  else line(ck.hasUploader ? "PASS" : "FAIL", `C8 /resume-checker ${ck.hasUploader ? "renders the scanner's uploader (#upload)" : "renders no uploader (#upload)"}`);
  for (const [path, p] of [["/", facts?.home], ["/pricing", facts?.pricing]]) {
    if (!p) { line("FAIL", `C9 ${path} could not be opened in the browser`); continue; }
    if (!p.rendered) { line("FAIL", `C9 ${path} did not render its page (no H1 in the page's own content)`); continue; }
    const bad = [];
    if (p.leaks.length) bad.push(`names ${[...new Set(p.leaks)].map((x) => `"${x}"`).join(", ")}`);
    if (p.filledHeader.length) bad.push(`the header has ${p.filledHeader.length} filled button(s) (${p.filledHeader.join(", ")})`);
    if (p.filledMain.length !== 1) bad.push(`main has ${p.filledMain.length} filled buttons${p.filledMain.length ? ` (${p.filledMain.join(", ")})` : ""}`);
    line(bad.length ? "FAIL" : "PASS", `C9 the rendered ${path} ${bad.length ? bad.join("; ") : `names no cut product, header to footer, and has one filled button ("${p.filledMain[0]}")`}`);
  }
  for (const a of C8_ADDRESSES) {
    const seen = (facts?.addresses ?? []).find((x) => x && x.from === a.from);
    if (!seen || !seen.finalUrl) { line("FAIL", `C8 "${a.from}" could not be opened in the browser`); continue; }
    const where = seen.finalUrl.replace(/^https?:\/\/[^/]+/, "") || "(nothing)";
    const search = a.from.slice(1).split("#")[0];
    const ok = a.want === "scanner" ? where.split("#")[0] === `/resume-checker${search}` : where.split("#")[0] === a.from;
    line(ok ? "PASS" : "FAIL", `C8 "${a.from}" lands on ${where}${ok ? "" : a.want === "scanner" ? ` (want /resume-checker${search}, the query kept)` : " (want it to stay on the homepage)"}`);
  }
  const fr = facts?.fragment;
  if (!fr || typeof fr.top !== "number") line("FAIL", "C12 \"/pricing#pro\" could not be opened in the browser, or has no #pro");
  else {
    const floor = Math.max(0, fr.headerBottom ?? 0) - 4;
    const ok = fr.top >= floor && fr.top < fr.innerHeight;
    line(ok ? "PASS" : "FAIL", `C12 a fresh "/pricing#pro" puts the Pro card's top at ${Math.round(fr.top)} px${ok ? `, inside the first screen and below the header (${Math.round(Math.max(0, fr.headerBottom ?? 0))} px)` : ` (want between the header's bottom, ${Math.round(Math.max(0, fr.headerBottom ?? 0))} px, and ${fr.innerHeight} px)`}`);
  }
  return out;
}

const pgVal = (v) => (Array.isArray(v) ? `{${v.map((x) => JSON.stringify(String(x))).join(",")}}` : v !== null && typeof v === "object" ? JSON.stringify(v) : String(v));
const ALLOWED_BOARD_ACTIONS = new Set(["list", "detail", "facets", "exists", "company-suggest"]);

async function pageFacts(page) {
  return page.evaluate((cut) => {
    const re = new RegExp(cut, "gi");
    // The live postings on "/" are employers' own words ("unlimited PTO", a
    // "Premium" brand): they are left out; everything we write is read.
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll("[data-home-rows]").forEach((e) => e.remove());
    const leaks = ((copy.innerText || copy.textContent || "").match(re) || []);
    const filled = (scope) => (scope ? [...scope.querySelectorAll("button, a")].filter((e) => /(^|\s)bg-primary(\s|$)/.test(e.className) && e.getClientRects().length).map((e) => (e.textContent || "").trim().slice(0, 40)) : []);
    const main = document.querySelector("main");
    return { rendered: !!(main && main.querySelector("h1")), leaks, filledHeader: filled(document.querySelector("header")), filledMain: filled(main) };
  }, CUT_PATTERN.source);
}

async function main() {
  const SITE = process.env.SITE || "https://resumebooster.work";
  const ROOT = process.env.REPO_ROOT || resolve(fileURLToPath(new URL("..", import.meta.url)));
  const candidates = [join(ROOT, "worker", "node_modules", "playwright"), join(ROOT, "node_modules", "playwright")];
  const at = candidates.find((c) => existsSync(join(c, "package.json")));
  if (!at) {
    console.log("INFO  C8 C9 no Playwright in this checkout (worker/node_modules or node_modules): the rendered pages are held by hp-routes and hp-fix-switch-over-gate in the suite");
    return;
  }
  const { chromium } = createRequire(import.meta.url)(at);
  let browser = null;
  let answered = 0;
  const facts = { upload: null, checker: null, home: null, pricing: null, addresses: [], fragment: null };
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
    await context.route("**/*", async (route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET" || method === "HEAD" || method === "OPTIONS") return route.continue();
      const url = new URL(req.url());
      if (/\.supabase\.co$/.test(url.host)) {
        const rpc = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(url.pathname);
        if (rpc && method === "POST") {
          let params = {};
          try { params = req.postData() ? JSON.parse(req.postData()) : {}; } catch { params = null; }
          if (params && typeof params === "object") {
            for (const [k, v] of Object.entries(params)) url.searchParams.set(k, pgVal(v));
            const headers = { ...req.headers() };
            delete headers["content-type"];
            delete headers["content-length"];
            const response = await route.fetch({ url: url.href, method: "GET", headers });
            // The body arrives decoded, so a copied content-encoding would be decoded twice.
            const out = { ...response.headers() };
            delete out["content-encoding"];
            delete out["content-length"];
            return route.fulfill({ status: response.status(), headers: out, body: await response.body() });
          }
        }
        if (url.pathname === "/functions/v1/job-board" && method === "POST") {
          let body = {};
          try { body = JSON.parse(req.postData() || "{}"); } catch { body = {}; }
          if (ALLOWED_BOARD_ACTIONS.has(body.action)) return route.continue({ headers: { ...req.headers(), "x-rb-budget": "probe" } });
        }
      }
      answered++;
      return route.fulfill({ status: 204, body: "" });
    });
    const page = await context.newPage();
    const open = async (path, waitFor) => {
      await page.goto(`${SITE}${path}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
    };
    try { await open("/", "#home-h1"); facts.home = await pageFacts(page); } catch { facts.home = null; }
    try { await open("/pricing", "#pricing-h1"); facts.pricing = await pageFacts(page); } catch { facts.pricing = null; }
    try {
      await open("/#upload", "#upload");
      const uploaderInView = await page.evaluate(() => { const u = document.getElementById("upload"); if (!u) return false; const b = u.getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; });
      facts.upload = { finalUrl: page.url(), uploaderInView };
    } catch { facts.upload = null; }
    try { await open("/resume-checker", "#upload"); facts.checker = { hasUploader: !!(await page.$("#upload")) }; } catch { facts.checker = null; }
    for (const a of C8_ADDRESSES) {
      try { await open(a.from, a.want === "scanner" ? "#upload" : "#home-h1"); facts.addresses.push({ ...a, finalUrl: page.url() }); } catch { /* judged as not opened */ }
    }
    try {
      await open("/pricing#pro", "#pricing-h1");
      await page.waitForTimeout(1200);
      facts.fragment = await page.evaluate(() => {
        const el = document.getElementById("pro");
        if (!el) return null;
        const header = document.querySelector("header");
        return { top: el.getBoundingClientRect().top, headerBottom: header ? header.getBoundingClientRect().bottom : 0, innerHeight: window.innerHeight };
      });
    } catch { facts.fragment = null; }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  for (const l of judgeRendered(facts)) console.log(l);
  console.log(`INFO  C8 C9 C12 the headless run answered ${answered} write request(s) inside the browser; nothing it sent could write`);
}

const isMain = (() => {
  try { return realpathSync(resolve(process.argv[1] || "")) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main().catch((e) => { console.log(`FAIL  C8 C9 the headless run crashed: ${String(e).slice(0, 160)}`); });
