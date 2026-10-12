// Writes the seed the bake carries once-published URLs from (SEO-002):
// scripts/seo-seed/published-company-paths.txt and
// scripts/seo-seed/published-posting-paths.txt.
//
//   node scripts/prerender-seed-history.mjs [extra ...]
//
// Every company and posting path in every committed version of
// public/sitemap.xml (git history, all refs), plus each extra file named on
// the command line: a sitemap, or a list of paths or URLs one a line (the
// live sitemap captures the SEO audit of 2026-10-11 saved). Sorted, unique,
// with a header naming the sources. Read-only on the network: it reads git
// and local files and nothing else.
//
// The bake reads these lists and never fetches them. A path already in the
// live ledger is the ledger's to decide; the seed adds only the paths the
// ledger has never named (seedPostingLedger, onceCompanyPaths in
// scripts/prerender-pages.mjs), so running this again changes nothing the
// bake already carries.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const company = new Set();
const posting = new Set();
const COMPANY = /^\/jobs\/company\/[A-Za-z0-9._~%-]+$/;
const POSTING = /^\/jobs\/posting\/[a-z0-9_-]+\/[^\s?#]+$/;
const add = (raw) => {
  const p = String(raw ?? "").trim().replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  if (COMPANY.test(p)) company.add(p);
  else if (POSTING.test(p)) posting.add(p);
};
const addText = (text) => {
  const locs = [...String(text).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  if (locs.length) locs.forEach(add);
  else String(text).split("\n").forEach(add);
};

const commits = git("log", "--all", "--format=%H", "--", "public/sitemap.xml").split("\n").filter(Boolean);
let versions = 0;
for (const h of commits) {
  try { addText(git("show", `${h}:public/sitemap.xml`)); versions++; } catch { /* the file did not exist at that commit */ }
}
const extras = process.argv.slice(2);
for (const f of extras) addText(readFileSync(f, "utf8"));

const out = join(root, "scripts", "seo-seed");
mkdirSync(out, { recursive: true });
const header = (what, n) => [
  `# ${what} this site has published, one path a line (${n}).`,
  `# Written by scripts/prerender-seed-history.mjs from ${versions} committed versions of public/sitemap.xml`,
  `# and ${extras.length} live sitemap capture file(s). The bake (scripts/prerender-seo.mjs) gives each`,
  "# path the ledger has never named a noindex page of its own (SEO-002). Never fetched; never pinged.",
];
writeFileSync(join(out, "published-company-paths.txt"), [...header("Company pages", company.size), ...[...company].sort()].join("\n") + "\n");
writeFileSync(join(out, "published-posting-paths.txt"), [...header("Posting pages", posting.size), ...[...posting].sort()].join("\n") + "\n");
console.log(`seed: ${company.size} company paths, ${posting.size} posting paths, from ${versions} sitemap versions and ${extras.length} capture file(s)`);
