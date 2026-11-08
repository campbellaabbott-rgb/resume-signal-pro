#!/usr/bin/env node
// THE PREVIOUS PUBLISH'S SITEMAP AND LEDGER, KEPT FOR THE NEXT VERIFY (B10,
// SEO/GEO audit 2026-11-07, finding F10).
//
// Section 76 F2a judges what became of the posting URLs the PREVIOUS publish
// named: each must still serve a page of its own (a live posting or a noindex
// "no longer listed" page), never the homepage copy. The live sitemap is the
// new bake's own and cannot say that, so F2a needs a copy saved before the
// publish. That copy was a manual curl nobody ran: on 2026-11-06 F2a printed
// "cannot judge" and the folder did not exist.
//
// Now scripts/verify-deploy.sh runs `node scripts/seo-previous-publish.mjs
// --save` as its last step, only when the run reached its end (a run that
// died part-way keeps the pair it had). It GETs the live /sitemap.xml and
// /prerender-ledger.json and keeps them in ~/.config/resumebooster/seo/:
//
//   last-sitemap.xml, last-prerender-ledger.json   the newest publish verified
//   prev-sitemap.xml, prev-prerender-ledger.json   the publish before it
//   saves.log                                      one line per save
//
// A new publish rotates last-* to prev-*; a second run on the same publish
// rotates nothing, so prev-* always holds the publish before the live one.
// F2a reads previousSitemap(): last-sitemap.xml when it is not the live one,
// otherwise prev-sitemap.xml. The Google Indexing notifier (B08) reads the
// ledger pair the same way. Read-only towards the site: two GETs.
//
//   node scripts/seo-previous-publish.mjs --save     prints one PASS / FAIL / INFO line
//   SITE, UA and VD_SEO_DIR override the site, the user agent and the folder.

import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The folder the pair lives in: VD_SEO_DIR, or ~/.config/resumebooster/seo. */
export const seoDir = (env = process.env) => (env && env.VD_SEO_DIR) || join(env && env.HOME ? env.HOME : homedir(), ".config", "resumebooster", "seo");

/** The five files, by role. */
export const pairPaths = (dir) => ({
  sitemap: join(dir, "last-sitemap.xml"),
  ledger: join(dir, "last-prerender-ledger.json"),
  prevSitemap: join(dir, "prev-sitemap.xml"),
  prevLedger: join(dir, "prev-prerender-ledger.json"),
  log: join(dir, "saves.log"),
});

const readOr = (path) => { try { return readFileSync(path, "utf8"); } catch { return ""; } };
const locCount = (xml) => (String(xml).match(/<loc>[^<]+<\/loc>/g) || []).length;

/** Why a body is not a sitemap worth keeping, or "" when it is one. */
export function sitemapProblem(xml) {
  const s = String(xml ?? "");
  if (!s.trim()) return "the live sitemap was empty or unreadable";
  if (!/<urlset[\s>]/.test(s)) return "the live sitemap is not a <urlset> (an HTML page, or an error, was served)";
  if (!locCount(s)) return "the live sitemap names no <loc>";
  return "";
}

/** Why a body is not a ledger worth keeping, or "" when it is one. */
export function ledgerProblem(text) {
  let j = null;
  try { j = JSON.parse(String(text ?? "")); } catch { return "the live ledger is not JSON"; }
  if (!j || typeof j !== "object" || typeof j.builtAt !== "string") return "the live ledger names no builtAt";
  return "";
}

const writeAtomic = (path, body) => {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, body);
  renameSync(tmp, path);
};

/**
 * Keep the live pair for the next publish's verify. Pure over the folder it
 * is handed. A body that is not a sitemap or a ledger is never saved, so a
 * gateway's error page cannot replace a good pair.
 *
 * Returns { status: "PASS" | "FAIL", line, rotated }.
 */
export function savePair({ dir, sitemapXml, ledgerText, now = new Date() }) {
  const bad = sitemapProblem(sitemapXml) || ledgerProblem(ledgerText);
  if (bad) return { status: "FAIL", rotated: false, line: `the live sitemap and ledger were not saved for the next publish's F2a: ${bad}. The saved pair in ${dir} stays as it was` };
  const p = pairPaths(dir);
  const builtAt = JSON.parse(ledgerText).builtAt;
  const n = locCount(sitemapXml);
  try {
    mkdirSync(dir, { recursive: true });
    const lastSitemap = readOr(p.sitemap);
    const lastLedger = readOr(p.ledger);
    // The same publish as the saved one: an earlier run of this publish (or a
    // copy saved by hand, which holds no ledger) already kept it. Nothing
    // rotates, so prev-* keeps the publish before this one.
    const samePublish = lastSitemap === sitemapXml && (!lastLedger || lastLedger === ledgerText);
    let rotated = false;
    let replaced = "";
    if (samePublish) {
      if (!lastLedger) writeAtomic(p.ledger, ledgerText);
    } else {
      if (lastSitemap) {
        renameSync(p.sitemap, p.prevSitemap);
        rotated = true;
        try { replaced = JSON.parse(lastLedger).builtAt || ""; } catch { replaced = ""; }
      } else rmSync(p.prevSitemap, { force: true });
      // The pair stays a pair: a previous sitemap saved with no ledger leaves
      // no older ledger beside it.
      if (lastLedger) renameSync(p.ledger, p.prevLedger);
      else rmSync(p.prevLedger, { force: true });
      writeAtomic(p.sitemap, sitemapXml);
      writeAtomic(p.ledger, ledgerText);
    }
    appendFileSync(p.log, `${now.toISOString()}\tbuilt ${builtAt}\t${n} URLs\t${samePublish ? "same publish" : rotated ? "rotated" : "first save"}\n`);
    const line = samePublish
      ? `the saved sitemap is already this publish's (${n} URLs, ledger built ${builtAt}); the publish before it stays in prev-sitemap.xml for F2a`
      : `saved this publish's sitemap (${n} URLs) and ledger (built ${builtAt}) to ${dir} for the next publish's F2a${rotated ? `; the pair it replaced${replaced ? ` (built ${replaced})` : ""} is now prev-*` : ""}`;
    return { status: "PASS", rotated, line };
  } catch (e) {
    return { status: "FAIL", rotated: false, line: `the live sitemap and ledger could not be written to ${dir}: ${String(e).slice(0, 160)}` };
  }
}

/**
 * The saved sitemap F2a should judge: the newest one that is not the live
 * sitemap itself. `reason` says why there is none: "none" (this machine has
 * never saved one), "missing" (saves.log says one was saved, and it is gone),
 * "own" (the only saved copy is the live publish's own).
 */
export function previousSitemap({ dir, liveSitemapXml }) {
  const p = pairPaths(dir);
  const live = String(liveSitemapXml ?? "");
  const last = readOr(p.sitemap);
  const prev = readOr(p.prevSitemap);
  const everSaved = existsSync(p.log);
  if (last && last !== live) return { raw: last, from: p.sitemap, everSaved, reason: "" };
  if (last && prev && prev !== live) return { raw: prev, from: p.prevSitemap, everSaved, reason: "" };
  return { raw: "", from: "", everSaved, reason: last ? "own" : everSaved ? "missing" : "none" };
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isMain) {
  if (!process.argv.includes("--save")) { console.error("usage: node scripts/seo-previous-publish.mjs --save"); process.exit(2); }
  const site = process.env.SITE || "https://resumebooster.work";
  const headers = process.env.UA ? { "User-Agent": process.env.UA } : {};
  const get = async (path) => {
    try {
      const r = await fetch(site + path, { headers, signal: AbortSignal.timeout(30000) });
      return r.ok ? await r.text() : "";
    } catch { return ""; }
  };
  const sitemapXml = await get("/sitemap.xml");
  const ledgerText = await get("/prerender-ledger.json");
  const r = savePair({ dir: seoDir(process.env), sitemapXml, ledgerText });
  console.log(`${r.status}  ${r.line}`);
}
