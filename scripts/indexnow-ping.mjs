#!/usr/bin/env node
// IndexNow: instantly notify Bing/Yandex (and anything else on the protocol)
// about our URLs instead of waiting for a crawl. Google ignores IndexNow (it
// has its own sitemap pipeline), so this complements GSC, not replaces it.
//
//   node scripts/indexnow-ping.mjs            every <loc> in public/sitemap.xml
//   node scripts/indexnow-ping.mjs --changed  only what the LIVE publish changed
//
// --changed (SEO report 2026-10-08, S3) reads the live sitemap and the ledger
// the bake serves beside it (/prerender-ledger.json): the pages whose
// sitemap date is the publish day, and the posting URLs that publish retired
// (a "no longer listed" or "no longer has a page" page, noindex), so a
// search engine learns of a removal as fast as of an addition. The post-
// publish verifier runs it on every clean pass (scripts/post-publish-smoke.mjs).
//
// The key file (public/<key>.txt) proves domain ownership; both it and the
// pinged pages must be LIVE in production first, so this runs after a
// publish is verified, never from the build.

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const INDEXNOW_KEY = "a546fa24b185c5a5ce1c3f93cb05a4f8";
export const INDEXNOW_HOST = "resumebooster.work";
const SITE = `https://${INDEXNOW_HOST}`;

/**
 * Ledger posting states that are a REMOVAL: the board said the posting is
 * gone ("gone"), or it no longer qualifies for a page ("retired"). Never
 * "unchecked": the board did not answer (a 429, a 5xx, a spent call budget),
 * so the posting may well be live, and pinging its noindex stub speeds Bing's
 * de-indexing of a live posting after one transient refusal (S11-155).
 */
const REMOVED_STATES = new Set(["gone", "retired"]);

/**
 * The URLs one publish changed: every sitemap entry whose lastmod is the
 * ledger's build day, plus every posting URL the ledger removed that day.
 * Pure, so the rule is tested without a network.
 */
export function changedUrls({ sitemapXml, ledger }) {
  const day = ledger && typeof ledger.builtAt === "string" ? ledger.builtAt : null;
  if (!day) return [];
  const out = new Set();
  for (const m of String(sitemapXml || "").matchAll(/<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    if (m[2].trim() === day) out.add(m[1].trim());
  }
  const postings = ledger.postings && typeof ledger.postings === "object" ? ledger.postings : {};
  for (const [path, e] of Object.entries(postings)) {
    if (e && REMOVED_STATES.has(e.state) && e.since === day && path.startsWith("/")) out.add(`${SITE}${path}`);
  }
  return [...out];
}

/** Every <loc> in a sitemap. */
export function allUrls(sitemapXml) {
  return [...String(sitemapXml || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/**
 * Submit a URL list. Returns { submitted, status } or { submitted: 0, reason }.
 * Never throws: a failed ping must not fail the verifier that called it.
 */
export async function submit(urls, { fetchImpl = fetch } = {}) {
  if (!urls.length) return { submitted: 0, reason: "nothing changed" };
  const keyUrl = `${SITE}/${INDEXNOW_KEY}.txt`;
  try {
    const keyResp = await fetchImpl(keyUrl, { signal: AbortSignal.timeout(10000) });
    const keyBody = (await keyResp.text()).trim();
    if (!keyResp.ok || keyBody !== INDEXNOW_KEY) return { submitted: 0, reason: `key file not live (${keyResp.status})` };
    // Bing's endpoint, not api.indexnow.org: the aggregator returned 403 for a
    // freshly-created key while Bing accepted the identical payload
    // (2026-07-06). Any participating engine shares submissions with the rest.
    const resp = await fetchImpl("https://www.bing.com/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: keyUrl, urlList: urls.slice(0, 10000) }),
      signal: AbortSignal.timeout(30000),
    });
    // 200 = accepted, 202 = accepted (key validation pending).
    return { submitted: Math.min(urls.length, 10000), status: resp.status, ok: resp.status === 200 || resp.status === 202 };
  } catch (e) {
    return { submitted: 0, reason: String(e).slice(0, 120) };
  }
}

/** --changed: what the live publish changed, read from the live site. */
export async function submitChanged({ fetchImpl = fetch } = {}) {
  const get = async (url) => {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      return r.ok ? await r.text() : null;
    } catch { return null; }
  };
  const sitemapXml = await get(`${SITE}/sitemap.xml`);
  const ledgerText = await get(`${SITE}/prerender-ledger.json`);
  let ledger = null;
  try { ledger = ledgerText ? JSON.parse(ledgerText) : null; } catch { ledger = null; }
  if (!sitemapXml || !ledger) return { submitted: 0, reason: `live ${!sitemapXml ? "sitemap" : "ledger"} unreadable` };
  return submit(changedUrls({ sitemapXml, ledger }), { fetchImpl });
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const result = process.argv.includes("--changed")
    ? await submitChanged()
    : await submit(allUrls(readFileSync(join(root, "public/sitemap.xml"), "utf8")));
  console.log(result.submitted
    ? `Submitted ${result.submitted} URLs to IndexNow — HTTP ${result.status} ${result.ok ? "(accepted)" : "(UNEXPECTED — check key/URLs)"}`
    : `IndexNow: nothing submitted (${result.reason})`);
  process.exit(result.submitted && !result.ok ? 1 : 0);
}
