#!/usr/bin/env node
// IndexNow: instantly notify Bing/Yandex (and anything else on the protocol)
// about our URLs instead of waiting for a crawl. Google ignores IndexNow (it
// has its own sitemap pipeline), so this complements GSC, not replaces it.
//
//   node scripts/indexnow-ping.mjs                    every <loc> in public/sitemap.xml
//   node scripts/indexnow-ping.mjs --changed          only what the LIVE publish changed
//   node scripts/indexnow-ping.mjs --urls <file>      every path or URL listed in <file>
//
// EACH OF THEM IS A DRY RUN unless INDEXNOW_SEND=1 is set: it prints the list
// and the counts and sends nothing. A send tells Bing, Yandex, Seznam and
// Naver about this site, and the owner decided (2026-11-07) that every send
// needs a fresh go-ahead, so a run that does not say go never sends, whoever
// runs it. INDEXNOW_SEND=1 is that go-ahead, given for one command:
//   INDEXNOW_SEND=1 node scripts/indexnow-ping.mjs --changed
// --dry-run still forces a dry run, and NO_INDEXNOW=1 still silences the
// post-publish verifier's step altogether.
//
// --changed (SEO report 2026-10-08, S3) reads the live sitemap and the ledger
// the bake serves beside it (/prerender-ledger.json): the pages whose
// sitemap date is the publish day, the pages whose TITLE changed that day
// (SEO-012: a page whose title changed is what search and AI indexes hold
// wrong, and a sitemap date blind to counts can miss it), and the posting URLs
// that publish retired (a "no longer listed" or "no longer has a page" page,
// noindex), so a search engine learns of a removal as fast as of an addition.
// The post-publish verifier lists them on every run
// (scripts/post-publish-smoke.mjs, afterPublishPing below) and sends them
// only on a clean pass with INDEXNOW_SEND=1.
//
// --urls (SEO-012) is the one-time resubmission of the URLs this site
// published before the ledger existed (scripts/seo-seed/), which indexes still
// hold with retired titles. IT IS A SUBMISSION: it sends only with the
// owner's go-ahead (INDEXNOW_SEND=1), after the deploy shows the stubs live.
// Its dry run is committed beside the seed
// (scripts/seo-seed/indexnow-historical-urls.txt).
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
/** Posting states whose page states nothing checked: never pinged for a title change either. */
const UNCHECKED_STATES = new Set(["unchecked", "seeded"]);

/**
 * Whether this run may send: only when INDEXNOW_SEND is exactly "1" (the
 * owner's go-ahead, 2026-11-07) and NO_INDEXNOW is not set. Anything else,
 * "true" and "yes" included, is no go-ahead. Pure over the env it is handed.
 */
export function indexNowSendAllowed(env = process.env) {
  const e = env ?? {};
  return e.INDEXNOW_SEND === "1" && !e.NO_INDEXNOW;
}

/** Why a run sent nothing, said the same way by every caller. */
export const SEND_NEEDS = "sending needs INDEXNOW_SEND=1, the owner's go-ahead";

/** The address a path is served at: a dotted last segment needs its trailing slash or the host 404s it. */
export const urlOfPath = (path) => `${SITE}${/\.[^/]*$/.test(path) ? `${path}/` : path}`;

/**
 * The URLs one publish changed: every sitemap entry whose lastmod is the
 * ledger's build day, every page whose title the ledger says changed that day
 * (its `thChanged`, which the bake moves only when a count-blind hash of the
 * title moves: a count-only re-date never counts), less any posting page that
 * states nothing checked, plus every posting URL the ledger removed that day.
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
    if (e && REMOVED_STATES.has(e.state) && e.since === day && e.seed !== true && path.startsWith("/")) out.add(`${SITE}${path}`);
  }
  const pages = ledger.pages && typeof ledger.pages === "object" ? ledger.pages : {};
  for (const [path, e] of Object.entries(pages)) {
    if (!e || e.thChanged !== day || !path.startsWith("/")) continue;
    const posting = postings[path];
    if (posting && (UNCHECKED_STATES.has(posting.state) || posting.seed === true)) continue;
    out.add(urlOfPath(path));
  }
  return [...out];
}

/** Every <loc> in a sitemap. */
export function allUrls(sitemapXml) {
  return [...String(sitemapXml || "").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

/**
 * The URLs a --urls file names: one path or full URL per line, # comments
 * and blank lines skipped, only this site's own addresses, each once, in the
 * order first listed. A path is turned into the address it is served at.
 */
export function urlsFromList(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let url;
    if (/^https?:\/\//i.test(line)) {
      let u;
      try { u = new URL(line); } catch { continue; }
      if (u.hostname !== INDEXNOW_HOST) continue;
      url = `${SITE}${u.pathname}`;
    } else if (line.startsWith("/")) {
      url = urlOfPath(line.replace(/\/+$/, "") || "/");
    } else continue;
    if (url === `${SITE}`) url = `${SITE}/`;
    if (!seen.has(url)) { seen.add(url); out.push(url); }
  }
  return out;
}

/** What a dry run prints: the counts by page family, then every URL. Nothing is sent. */
export function dryRunReport(urls, { label = "" } = {}) {
  const family = (u) => {
    const p = u.replace(SITE, "");
    if (p.startsWith("/jobs/posting/")) return "posting pages";
    if (p.startsWith("/jobs/company/")) return "company pages";
    return "other pages";
  };
  const counts = {};
  for (const u of urls) counts[family(u)] = (counts[family(u)] ?? 0) + 1;
  const head = [
    `# IndexNow DRY RUN${label ? ` — ${label}` : ""}: nothing was sent.`,
    `# ${urls.length} URL(s): ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}.`,
    `# Bing accepts at most 10,000 per submission; ${urls.length > 10000 ? `this list needs ${Math.ceil(urls.length / 10000)} submissions` : "this list fits one"}.`,
  ];
  return `${[...head, ...urls].join("\n")}\n`;
}

/**
 * Submit a URL list. Returns { submitted, status } or { submitted: 0, reason }.
 * Never throws: a failed ping must not fail the verifier that called it.
 * With `dryRun`, sends nothing at all and says so. WITHOUT THE GO-AHEAD IN
 * `env` (indexNowSendAllowed) it is a dry run too, whatever the caller asked:
 * the rule sits here, at the one place a send happens, so no caller can
 * forget it (`held` says the go-ahead was what was missing).
 */
export async function submit(urls, { fetchImpl = fetch, dryRun = false, env = process.env } = {}) {
  if (!urls.length) return { submitted: 0, reason: "nothing changed" };
  if (dryRun) return { submitted: 0, reason: `dry run — ${urls.length} URL(s) listed, none sent`, dryRun: true, urls };
  if (!indexNowSendAllowed(env)) return { submitted: 0, reason: `dry run — ${urls.length} URL(s) listed, none sent (${SEND_NEEDS})`, dryRun: true, held: true, urls };
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
export async function submitChanged({ fetchImpl = fetch, dryRun = false, env = process.env } = {}) {
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
  return submit(changedUrls({ sitemapXml, ledger }), { fetchImpl, dryRun, env });
}

/**
 * THE POST-PUBLISH VERIFIER'S STEP (scripts/post-publish-smoke.mjs section 9).
 * It used to send on every clean pass unless NO_INDEXNOW was set, so the
 * routine `npm run verify:deploy` told Bing about some 960 URLs with nobody
 * having said go (SEO/GEO audit 2026-11-07, IDX-05). Now it lists what the
 * live publish changed and sends only on a clean pass with INDEXNOW_SEND=1;
 * NO_INDEXNOW=1 skips even the list.
 *
 * Returns { status: "PASS" | "FAIL" | "INFO", line, report }: `report` is the
 * dry-run list to print (empty when nothing was listed or a send happened),
 * and only a send that was answered with an error is a FAIL.
 */
export async function afterPublishPing({ env = process.env, clean = true, fetchImpl = fetch } = {}) {
  const e = env ?? {};
  if (e.NO_INDEXNOW) return { status: "INFO", line: "IndexNow: skipped, nothing listed or sent (NO_INDEXNOW is set)", report: "" };
  const send = clean && indexNowSendAllowed(e);
  const r = await submitChanged({ fetchImpl, dryRun: !send, env: e });
  if (r.dryRun) {
    const why = indexNowSendAllowed(e) ? "the pass was not clean, and a broken publish is not one to advertise" : SEND_NEEDS;
    return { status: "INFO", line: `IndexNow dry run: ${r.urls.length} URL(s), nothing sent (${why})`, report: dryRunReport(r.urls, { label: "what this publish changed" }) };
  }
  if (r.submitted) {
    return { status: r.ok ? "PASS" : "FAIL", line: `IndexNow told what this publish changed: ${r.submitted} URL(s), HTTP ${r.status}${r.ok ? " (accepted)" : " (UNEXPECTED: check the key and the URLs)"}`, report: "" };
  }
  return { status: "INFO", line: `${send ? "IndexNow" : "IndexNow dry run"}: nothing listed or sent (${r.reason})`, report: "" };
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  // A dry run when asked for one, or when the go-ahead is missing (submit
  // would hold the send anyway; deciding here also prints the list).
  const held = !args.includes("--dry-run") && !indexNowSendAllowed(process.env);
  const dryRun = args.includes("--dry-run") || held;
  const listAt = args.indexOf("--urls");
  let result;
  if (listAt >= 0) {
    const file = args[listAt + 1];
    if (!file || file.startsWith("--")) { console.error("IndexNow: --urls needs a file of paths or URLs"); process.exit(2); }
    const urls = urlsFromList(readFileSync(resolve(file), "utf8"));
    if (dryRun) process.stdout.write(dryRunReport(urls, { label: file }));
    result = await submit(urls, { dryRun });
  } else if (args.includes("--changed")) {
    result = await submitChanged({ dryRun });
    if (dryRun && result.urls) process.stdout.write(dryRunReport(result.urls, { label: "--changed" }));
  } else {
    const urls = allUrls(readFileSync(join(root, "public/sitemap.xml"), "utf8"));
    if (dryRun) process.stdout.write(dryRunReport(urls, { label: "public/sitemap.xml" }));
    result = await submit(urls, { dryRun });
  }
  console.log(result.submitted
    ? `Submitted ${result.submitted} URLs to IndexNow — HTTP ${result.status} ${result.ok ? "(accepted)" : "(UNEXPECTED — check key/URLs)"}`
    : `IndexNow: nothing submitted (${result.reason}${held && result.dryRun ? `; ${SEND_NEEDS}` : ""})`);
  process.exit(result.submitted && !result.ok ? 1 : 0);
}
