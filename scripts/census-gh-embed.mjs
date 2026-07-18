#!/usr/bin/env node
// Embedded-Greenhouse census: companies that EMBED the Greenhouse widget on
// their own careers page never expose a hosted board page — but the embed
// iframe URL (boards.greenhouse.io/embed/job_board?for={token}) is crawled.
// The path-segment census discards these ("embed" is infrastructure), so this
// pass re-reads the same columnar blocks and extracts the ?for= tokens.
//
// Usage: node scripts/census-gh-embed.mjs <crawl-id> [crawl-id…] <out.json>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);

const args = process.argv.slice(2);
const OUT = args.pop();
const CRAWLS = args;
if (!CRAWLS.length || !OUT) { console.error("usage: census-gh-embed.mjs <crawl>… <out.json>"); process.exit(1); }
const DATA = "https://data.commoncrawl.org";
const UA = "resumebooster.work census (contact: support@resumebooster.work)";
const PREFIXES = ["io,greenhouse,boards)/", "io,greenhouse,job-boards)/"];

async function curlBuf(url, range) {
  for (let i = 0; i < 5; i++) {
    try {
      const cliArgs = ["-s", "-m", "120", "-H", `User-Agent: ${UA}`];
      if (range) cliArgs.push("-r", range);
      cliArgs.push(url, "--output", "-");
      const { stdout } = await execFileP("/usr/bin/curl", cliArgs, { maxBuffer: 512 * 1024 * 1024, encoding: "buffer" });
      if (stdout.length > 0) return stdout;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
  }
  return null;
}

const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
const tokens = new Set(fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, "utf8")).greenhouse ?? []) : []);
for (const crawl of CRAWLS) {
  const idxPath = path.join(os.tmpdir(), `cluster-${crawl}.idx`);
  if (!fs.existsSync(idxPath)) {
    console.log(`${crawl}: cluster.idx not cached — downloading`);
    const buf = await curlBuf(`${DATA}/cc-index/collections/${crawl}/indexes/cluster.idx`);
    if (!buf) { console.log(`${crawl}: unreachable, skipped`); continue; }
    fs.writeFileSync(idxPath, buf);
  }
  const lines = fs.readFileSync(idxPath, "utf8").split("\n");
  let found = 0;
  for (const prefix of PREFIXES) {
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(prefix)) {
        const add = (ln) => { const p = ln.split("\t"); if (p.length >= 4) blocks.push({ shard: p[1], off: Number(p[2]), len: Number(p[3]) }); };
        if (blocks.length === 0 && i > 0) add(lines[i - 1]);
        add(lines[i]);
      } else if (blocks.length > 0) break;
    }
    for (const b of blocks) {
      if (!Number.isFinite(b.off) || !Number.isFinite(b.len) || b.len <= 0) continue;
      const gz = await curlBuf(`${DATA}/cc-index/collections/${crawl}/indexes/${b.shard}`, `${b.off}-${b.off + b.len - 1}`);
      if (!gz) continue;
      let text;
      try { text = zlib.gunzipSync(gz).toString("utf8"); } catch { continue; }
      for (const m of text.matchAll(/\/embed\/job_board[^"\s]*?[?&]for=([A-Za-z0-9_-]{2,64})/g)) {
        const t = m[1].toLowerCase();
        if (TOKEN_RE.test(t)) { tokens.add(t); found++; }
      }
    }
  }
  console.log(`${crawl}: +${found} embed hits, ${tokens.size} unique tokens total`);
}
fs.writeFileSync(OUT, JSON.stringify({ greenhouse: [...tokens].sort() }, null, 1));
console.log(`Wrote ${OUT}: ${tokens.size} embedded-greenhouse candidates`);
