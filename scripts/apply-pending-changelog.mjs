#!/usr/bin/env node
// THE CHANGELOG STEP: entries written before a deploy, applied after it verifies.
//
//   node scripts/apply-pending-changelog.mjs <pending.json> <YYYY-MM-DD>
//
// The owner's rule (2026-10-10): every verified deploy ends with changelog
// entries in nine languages, dated the day the change went live and shipped in
// the next frontend publish; nothing not yet live gets an entry. Merging into
// main publishes the frontend by itself (land/all final recheck, 2026-10-31),
// so entries that ride in the deploy's own merge go live before the functions
// they describe. They wait in docs/changelog-pending/<name>.json instead:
//   { "date": "DATE_OF_DEPLOY", "entries": [ { key, category, en, en-GB, de, es, fr, hi, nl, pt, tl } ] }
// (category is the tag list: "improved, fixed"). This script, run on a branch
// from main once the deploy has verified, with the day its functions went live:
//   - inserts one line per entry at the TOP of src/data/changelog.ts, in the
//     file's order, each { id, date, tags };
//   - appends each key at the END of changelogEntries in the nine
//     src/i18n/changelog/<lng>.json shards, serialised as they already are
//     (two-space JSON, each file keeping its own trailing newline);
//   - deletes the pending file, so the commit that carries the entries is the
//     one that empties the queue.
// It refuses (exit 1, nothing written) on a date that is not YYYY-MM-DD, a key
// already present, a missing shard or locale text, or an unknown tag.
// Verify section 52b judges the result once it is published.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];
const ANCHOR = "export const changelog: ChangelogEntry[] = [\n";

/** The new file texts, or a refusal. Pure: read(path) gives a file's text or null. */
export function applyPending({ pending, date, read }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return { error: `date ${JSON.stringify(date)} is not YYYY-MM-DD` };
  const entries = pending?.entries;
  if (!Array.isArray(entries) || !entries.length) return { error: "the pending file lists no entries" };
  const ts = read("src/data/changelog.ts");
  if (ts == null) return { error: "src/data/changelog.ts cannot be read" };
  if (ts.split(ANCHOR).length !== 2) return { error: "changelog.ts array opening not found exactly once" };
  const lines = [];
  for (const e of entries) {
    if (!/^[A-Za-z0-9]+$/.test(String(e?.key))) return { error: `bad key ${JSON.stringify(e?.key)}` };
    if (new RegExp(`id:\\s*"${e.key}"`).test(ts)) return { error: `changelog.ts already has ${e.key}` };
    const tags = String(e.category ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    if (!tags.length) return { error: `${e.key} has no tag` };
    for (const t of tags) if (!["new", "improved", "fixed"].includes(t)) return { error: `bad tag ${JSON.stringify(t)} on ${e.key}` };
    lines.push(`  { id: "${e.key}", date: "${date}", tags: [${tags.map((t) => `"${t}"`).join(", ")}] },\n`);
  }
  const files = {};
  for (const lng of LOCALES) {
    const p = `src/i18n/changelog/${lng}.json`;
    const raw = read(p);
    if (raw == null) return { error: `missing shard ${p}` };
    const d = JSON.parse(raw);
    const ce = d.changelogEntries;
    for (const e of entries) {
      if (Object.prototype.hasOwnProperty.call(ce, e.key)) return { error: `${lng}.json already has ${e.key}` };
      const t = e[lng]?.title, desc = e[lng]?.description;
      if (typeof t !== "string" || typeof desc !== "string" || t.length <= 4 || desc.length <= 20) return { error: `${lng} text missing or too short for ${e.key}` };
      if (/DATE_OF_DEPLOY/.test(t + desc)) return { error: `${lng} text of ${e.key} carries the placeholder` };
      ce[e.key] = { title: t, description: desc };
    }
    files[p] = JSON.stringify(d, null, 2) + (raw.endsWith("\n") ? "\n" : "");
  }
  const i = ts.indexOf(ANCHOR) + ANCHOR.length;
  files["src/data/changelog.ts"] = ts.slice(0, i) + lines.join("") + ts.slice(i);
  return { files, count: entries.length };
}

async function main(argv) {
  const [pendingPath, date] = argv;
  if (!pendingPath || !date) { console.error("usage: node scripts/apply-pending-changelog.mjs <pending.json> <YYYY-MM-DD>"); process.exit(1); }
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const abs = resolve(process.cwd(), pendingPath);
  if (!existsSync(abs)) { console.error(`REFUSED: ${pendingPath} does not exist`); process.exit(1); }
  const out = applyPending({ pending: JSON.parse(readFileSync(abs, "utf8")), date, read: (p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } } });
  if (out.error) { console.error(`REFUSED: ${out.error}`); process.exit(1); }
  for (const [p, text] of Object.entries(out.files)) writeFileSync(join(root, p), text);
  unlinkSync(abs);
  console.log(`inserted ${out.count} entries dated ${date} into changelog.ts and ${LOCALES.length} shards; removed ${pendingPath}`);
}

const isEntry = (() => { try { return resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url); } catch { return false; } })();
if (isEntry) await main(process.argv.slice(2));
