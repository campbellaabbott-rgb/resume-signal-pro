#!/usr/bin/env node
// IndexNow: instantly notify Bing/Yandex (and anything else on the protocol)
// about our URLs instead of waiting for a crawl. Run after every publish that
// adds or changes pages:
//
//   npm run indexnow
//
// Reads every <loc> from public/sitemap.xml and submits them in one batch.
// The key file (public/<key>.txt) proves domain ownership; both it and the
// pinged pages must be LIVE in production first — so run this after the
// deploy is verified, not before. Google ignores IndexNow (it has its own
// sitemap pipeline), so this complements GSC, not replaces it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KEY = "a546fa24b185c5a5ce1c3f93cb05a4f8";
const HOST = "resumebooster.work";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sitemap = readFileSync(join(root, "public/sitemap.xml"), "utf8");
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (urls.length === 0) throw new Error("No URLs found in sitemap.xml");

// Preflight: the key file must be reachable or every submission is rejected.
const keyUrl = `https://${HOST}/${KEY}.txt`;
const keyResp = await fetch(keyUrl, { signal: AbortSignal.timeout(10000) });
const keyBody = (await keyResp.text()).trim();
if (!keyResp.ok || keyBody !== KEY) {
  console.error(`Key file not live yet (${keyResp.status} at ${keyUrl}) — deploy first, then rerun.`);
  process.exit(1);
}

const resp = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: keyUrl, urlList: urls }),
  signal: AbortSignal.timeout(30000),
});

// 200 = accepted, 202 = accepted (key validation pending) — both are success.
console.log(`Submitted ${urls.length} URLs to IndexNow — HTTP ${resp.status} ${resp.status === 200 || resp.status === 202 ? "(accepted)" : "(UNEXPECTED — check key/URLs)"}`);
process.exit(resp.status === 200 || resp.status === 202 ? 0 : 1);
