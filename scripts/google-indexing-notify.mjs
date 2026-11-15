#!/usr/bin/env node
// GOOGLE INDEXING API NOTICES FOR POSTING PAGES, DRY RUN UNLESS THE OWNER SAYS
// GO (B08, SEO/GEO audit 2026-11-07, finding SD-06; owner decisions of
// 2026-10-11 and 2026-11-07).
//
// Posting pages live 30 days at most, and 77% of the 10-18 posting URLs were
// replaced within 12 days, so a new page may not be crawled before it expires
// and a closed one can stay in Google's index for weeks. Google's Indexing API
// exists for exactly these pages (JobPosting): URL_UPDATED asks for a crawl of
// a new page, URL_DELETED says a page is gone. Nothing in the repo called it.
//
// WHAT IT LISTS. The live /prerender-ledger.json against the previous
// publish's, which scripts/verify-deploy.sh saves to ~/.config/resumebooster/
// seo/ (seo-previous-publish.mjs, previousLedger):
//   URL_DELETED  a posting page that was live and is not any more: gone, its
//                employer closed it (B01), retired, a tombstone, or no longer
//                named at all;
//   URL_UPDATED  a posting page live now that was not live before and carries
//                its JobPosting (an entry with markupWithheld carries none, so
//                it is not a job page to this API; with the STOP switch off,
//                no page is).
// Only /jobs/posting/ addresses, never a company page or any other family: the
// API is for job pages. Deletions first, then new pages, capped at the
// project's daily quota (200 unless --cap says less), the rest printed as
// left for the next run.
//
// WHEN IT SENDS. Only with BOTH --send on the command line AND INDEXING_SEND=1
// in the environment (the owner's go-ahead, given for one command), and the
// service-account key at ~/.config/resumebooster/google-indexing-key.json
// (never in the repo, never in the scratchpad). The key signs an RS256 JWT with
// node:crypto, traded at Google's token endpoint for an access token. Without
// all three it prints the list and its counts and makes no request but the GET
// of the live ledger (none with --live). Never in CI, never automatic: the
// post-publish verifier prints this dry run and nothing else.
//
// Usage:
//   node scripts/google-indexing-notify.mjs                  dry run against the live site
//   node scripts/google-indexing-notify.mjs --live a.json --previous b.json
//   INDEXING_SEND=1 node scripts/google-indexing-notify.mjs --send [--cap N]
// SITE and VD_SEO_DIR override the site and the saved-ledger folder.

import { createSign } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { urlOfPath } from "./indexnow-ping.mjs";
import { previousLedger, seoDir } from "./seo-previous-publish.mjs";

export const SITE = "https://resumebooster.work";
export const POSTING_PREFIX = "/jobs/posting/";
/** The Indexing API's default publish quota per project per day. */
export const DAILY_QUOTA = 200;
export const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const PUBLISH_ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
export const SEND_NEEDS = "sending needs --send and INDEXING_SEND=1, the owner's go-ahead, and the service-account key at ~/.config/resumebooster/google-indexing-key.json";

/** Whether this run may send: --send on the command line AND INDEXING_SEND exactly "1". */
export function indexingSendAllowed({ argv = [], env = {} } = {}) {
  return argv.includes("--send") && (env ?? {}).INDEXING_SEND === "1";
}

/** Where the service-account key lives: ~/.config/resumebooster, under the HOME the run was given. */
export const keyPath = (env = process.env) => join((env && env.HOME) || homedir(), ".config", "resumebooster", "google-indexing-key.json");

const postingsOf = (ledger) => {
  const p = ledger && typeof ledger === "object" && ledger.postings && typeof ledger.postings === "object" ? ledger.postings : {};
  return Object.entries(p).filter(([path, e]) => typeof path === "string" && path.startsWith(POSTING_PREFIX) && e && typeof e === "object");
};
const isLive = (e) => !!e && e.state === "live";
/** A live page this API may be told about: it carries its JobPosting. */
const isJobPage = (e) => isLive(e) && !e.markupWithheld;

/**
 * What changed between two ledgers, by posting path, sorted: `deleted` were
 * live and are not now; `updated` are live job pages now that were not live.
 */
export function indexingDiff({ previous, live }) {
  const before = new Map(postingsOf(previous));
  const now = new Map(postingsOf(live));
  const deleted = [...before].filter(([path, e]) => isLive(e) && !isLive(now.get(path))).map(([path]) => path).sort();
  const updated = [...now].filter(([path, e]) => isJobPage(e) && !isLive(before.get(path))).map(([path]) => path).sort();
  return { deleted, updated };
}

/** The notices one run makes, deletions first, cut at `cap`; the rest are `left`. */
export function plannedNotices({ deleted = [], updated = [] }, cap = DAILY_QUOTA) {
  const all = [...deleted.map((path) => ({ type: "URL_DELETED", path })), ...updated.map((path) => ({ type: "URL_UPDATED", path }))]
    .map((n) => ({ ...n, url: urlOfPath(n.path) }));
  const n = Math.max(0, Math.min(Number.isFinite(cap) ? Math.floor(cap) : DAILY_QUOTA, DAILY_QUOTA));
  return { notices: all.slice(0, n), left: all.slice(n) };
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** An RS256 JWT a service account trades for an access token (no dependency: node:crypto signs it). */
export function serviceAccountJwt(key, now = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: INDEXING_SCOPE, aud: key.token_uri || TOKEN_ENDPOINT, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;
}

const argValue = (argv, flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const parse = (text) => { try { return JSON.parse(String(text ?? "")); } catch { return null; } };

/**
 * One run. Pure over what it is handed: argv, env, a fetch, a file reader and
 * a clock. Returns { status: "INFO" | "PASS" | "FAIL", line, report, sent }.
 */
export async function notify({ argv = [], env = process.env, fetchImpl = globalThis.fetch, readFile = (p) => readFileSync(p, "utf8"), now = new Date() } = {}) {
  const site = (env && env.SITE) || SITE;
  const capArg = argValue(argv, "--cap");
  const cap = capArg === null ? DAILY_QUOTA : Number(capArg);
  const report = [];

  // The live ledger: a file, or one GET of the site's.
  const liveFile = argValue(argv, "--live");
  let liveText = "";
  let liveFrom = liveFile;
  if (liveFile) {
    try { liveText = readFile(liveFile); } catch { liveText = ""; }
  } else {
    liveFrom = `${site}/prerender-ledger.json`;
    try {
      const r = await fetchImpl(liveFrom, { method: "GET", signal: AbortSignal.timeout(30000) });
      liveText = r.ok ? await r.text() : "";
    } catch { liveText = ""; }
  }
  const live = parse(liveText);
  if (!live || typeof live.builtAt !== "string") return { status: "FAIL", sent: 0, report: "", line: `the live ledger could not be read from ${liveFrom}: nothing listed, nothing sent` };

  // The previous publish's: a file, or the saved pair.
  const prevFile = argValue(argv, "--previous");
  let prevText = "";
  let prevFrom = prevFile;
  if (prevFile) {
    try { prevText = readFile(prevFile); } catch { prevText = ""; }
  } else {
    const saved = previousLedger({ dir: seoDir(env), liveLedgerText: liveText });
    prevText = saved.raw;
    prevFrom = saved.from;
    if (!saved.raw) {
      const why = saved.reason === "own" ? "the only saved ledger is the live publish's own" : saved.reason === "missing" ? "a saved ledger went missing" : "this machine has never saved one (scripts/verify-deploy.sh does, at the end of a run)";
      return { status: "INFO", sent: 0, report: "", line: `Indexing API: no previous publish's ledger to diff against (${why}): nothing listed, nothing sent` };
    }
  }
  const previous = parse(prevText);
  if (!previous || typeof previous !== "object") return { status: "FAIL", sent: 0, report: "", line: `the previous ledger could not be read from ${prevFrom}: nothing listed, nothing sent` };

  const diff = indexingDiff({ previous, live });
  const { notices, left } = plannedNotices(diff, cap);
  const send = indexingSendAllowed({ argv, env });
  report.push(`# Google Indexing API ${send ? "SEND" : "DRY RUN"} — posting pages this publish added and retired${send ? "" : ": nothing was sent"}.`);
  report.push(`# live ledger built ${live.builtAt} (${liveFrom}); previous built ${previous.builtAt ?? "?"} (${prevFrom})`);
  report.push(`# ${diff.updated.length} new (URL_UPDATED), ${diff.deleted.length} retired (URL_DELETED); this run's cap ${Math.min(Number.isFinite(cap) ? cap : DAILY_QUOTA, DAILY_QUOTA)}, deletions first; ${left.length} left for the next run`);
  for (const n of notices) report.push(`${n.type} ${n.url}`);
  for (const n of left) report.push(`# left: ${n.type} ${n.url}`);
  const counts = `${notices.filter((n) => n.type === "URL_DELETED").length} URL_DELETED + ${notices.filter((n) => n.type === "URL_UPDATED").length} URL_UPDATED`;

  if (!send) return { status: "INFO", sent: 0, report: `${report.join("\n")}\n`, line: `Indexing API dry run: ${counts} listed, nothing sent (${SEND_NEEDS})` };
  if (!notices.length) return { status: "PASS", sent: 0, report: `${report.join("\n")}\n`, line: "Indexing API: nothing changed among the posting pages, nothing to send" };

  // The go-ahead was given. The key, then a token, then one notice at a time.
  const kp = keyPath(env);
  const key = parse((() => { try { return readFile(kp); } catch { return ""; } })());
  if (!key || typeof key.client_email !== "string" || typeof key.private_key !== "string") return { status: "FAIL", sent: 0, report: `${report.join("\n")}\n`, line: `Indexing API: no service-account key at ${kp} (client_email and private_key): nothing sent` };
  let token = "";
  try {
    const assertion = serviceAccountJwt(key, now);
    const r = await fetchImpl(key.token_uri || TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
    const j = parse(await r.text());
    token = r.ok && j && typeof j.access_token === "string" ? j.access_token : "";
    if (!token) return { status: "FAIL", sent: 0, report: `${report.join("\n")}\n`, line: `Indexing API: the token endpoint answered ${r.status} with no access token: nothing sent` };
  } catch (e) {
    return { status: "FAIL", sent: 0, report: `${report.join("\n")}\n`, line: `Indexing API: the token request failed (${String(e).slice(0, 120)}): nothing sent` };
  }
  let sent = 0;
  const failed = [];
  for (const n of notices) {
    let status = 0;
    try {
      const r = await fetchImpl(PUBLISH_ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ url: n.url, type: n.type }) });
      status = r.status;
    } catch { status = 0; }
    if (status >= 200 && status < 300) { sent++; continue; }
    failed.push(`${n.type} ${n.url} -> ${status || "no answer"}`);
    // Out of quota: the rest wait for tomorrow.
    if (status === 429) break;
  }
  const rest = notices.length - sent - failed.length;
  report.push(...failed.map((f) => `# failed: ${f}`));
  return {
    status: failed.length ? "FAIL" : "PASS",
    sent,
    report: `${report.join("\n")}\n`,
    line: `Indexing API: sent ${sent} of ${notices.length} (${counts})${failed.length ? `; ${failed.length} failed (first: ${failed[0]})` : ""}${rest > 0 ? `; ${rest} not tried after the quota ran out` : ""}${left.length ? `; ${left.length} left for the next run` : ""}`,
  };
}

const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();

if (isMain) {
  const r = await notify({ argv: process.argv.slice(2), env: process.env });
  if (r.report) process.stdout.write(r.report);
  console.log(`${r.status.padEnd(5)} ${r.line}`);
  process.exit(r.status === "FAIL" ? 1 : 0);
}
