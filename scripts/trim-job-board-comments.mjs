#!/usr/bin/env node
/**
 * MOVE A JOB-BOARD FILE'S LONG COMMENT RUNS INTO THE NOTES DOC (S12-083).
 *
 * Lovable's deploy tally counts the raw source of the function's folder and
 * the whole _shared folder, comments included; over the line the deploy
 * reports success and the PREVIOUS bundle keeps serving. This moves every run
 * of `min` or more consecutive full-line // comments out of a file into
 * docs/job-board-index-notes.md, leaving one pointer line where the run was,
 * exactly as the .81 trim did for runs over six lines.
 *
 *   node scripts/trim-job-board-comments.mjs <file> [--min 3] [--keep <file of first-line texts>] [--dry]
 *
 * Comments are found with the TypeScript parser (a // inside a string, a
 * template or a regex is code, not a comment). A run whose last line is a
 * lint or type directive keeps that line. A run listed in --keep (by its first
 * comment line, trimmed) stays, for the guards that read a reason beside its
 * code. The file's code is proved unchanged: every comment stripped from both
 * versions, whitespace collapsed, the two must be equal, or nothing is written.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && !args[args.indexOf(a) - 1]?.startsWith("--"));
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const MIN = Number(opt("min", "3"));
const DRY = args.includes("--dry");
const DOC = resolve(opt("doc", "docs/job-board-index-notes.md"));
const keep = new Set((opt("keep", "") ? readFileSync(opt("keep"), "utf8").split("\n") : []).map((l) => l.trim()).filter(Boolean));
if (!file) { console.error("usage: trim-job-board-comments.mjs <file> [--min 3] [--keep f] [--dry]"); process.exit(2); }

const src = readFileSync(file, "utf8");
const relFile = file.replace(/^.*supabase\/functions\//, "supabase/functions/");

/** Every comment range in a source text, by walking its tokens. */
function commentRanges(text) {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.ES2022, true);
  const seen = new Map();
  const add = (r) => { if (r && !seen.has(r.pos)) seen.set(r.pos, r); };
  const visit = (node) => {
    for (const r of ts.getLeadingCommentRanges(text, node.pos) ?? []) add(r);
    for (const r of ts.getTrailingCommentRanges(text, node.end) ?? []) add(r);
    for (const c of node.getChildren(sf)) visit(c);
  };
  visit(sf);
  for (const r of ts.getLeadingCommentRanges(text, sf.endOfFileToken.pos) ?? []) add(r);
  return [...seen.values()].sort((a, b) => a.pos - b.pos);
}
const strip = (text) => {
  let out = "";
  let at = 0;
  for (const r of commentRanges(text)) { out += text.slice(at, r.pos); at = r.end; }
  return (out + text.slice(at)).replace(/\s+/g, " ").trim();
};

const lines = src.split("\n");
const lineStart = [];
{ let p = 0; for (const l of lines) { lineStart.push(p); p += l.length + 1; } }
const single = new Set(commentRanges(src).filter((r) => r.kind === ts.SyntaxKind.SingleLineCommentTrivia).map((r) => r.pos));
// A full-line comment: the line's first non-blank character starts a // comment that runs to the line's end.
const fullLine = lines.map((l, i) => {
  const lead = l.length - l.trimStart().length;
  return l.trimStart().startsWith("//") && single.has(lineStart[i] + lead);
});
const DIRECTIVE = /^\/\/\s*(?:deno-lint-ignore|eslint-|@ts-|prettier-ignore|deno-fmt-ignore|biome-ignore)/;
const POINTER = /^\/\/\s*Rationale: docs\//;

const docText = readFileSync(DOC, "utf8");
let next = Math.max(0, ...[...docText.matchAll(/^## n(\d+)-/gm)].map((m) => Number(m[1]))) + 1;
const slugOf = (code) => (code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).slice(0, 6).join("-").toLowerCase().slice(0, 40).replace(/-+$/, "") || "block";

const out = [];
const sections = [];
let moved = 0, kept = 0, saved = 0;
for (let i = 0; i < lines.length;) {
  if (!fullLine[i]) { out.push(lines[i]); i++; continue; }
  let j = i;
  while (j < lines.length && fullLine[j]) j++;
  let run = lines.slice(i, j);
  const tail = [];
  while (run.length && DIRECTIVE.test(run[run.length - 1].trim())) tail.unshift(run.pop());
  const first = run[0]?.trim() ?? "";
  if (run.length < MIN || run.some((l) => POINTER.test(l.trim())) || keep.has(first)) {
    if (run.length >= MIN && keep.has(first)) kept++;
    out.push(...run, ...tail);
    i = j;
    continue;
  }
  const indent = run[0].slice(0, run[0].length - run[0].trimStart().length);
  const codeLine = (lines.slice(j).find((l) => l.trim() && !l.trim().startsWith("//")) ?? "").trim();
  const slug = `n${String(next++).padStart(3, "0")}-${slugOf(codeLine)}`;
  const pointer = `${indent}// Rationale: docs/job-board-index-notes.md#${slug}`;
  out.push(pointer, ...tail);
  const body = run.map((l) => l.trim().replace(/^\/\/ ?/, "")).join("\n");
  sections.push(`## ${slug}\n\nIn \`${relFile}\`, above: \`${codeLine.slice(0, 140).replace(/`/g, "'")}\`\n\n${body}\n`);
  saved += run.reduce((n, l) => n + Buffer.byteLength(l, "utf8") + 1, 0) - Buffer.byteLength(pointer, "utf8") - 1;
  moved++;
  i = j;
}
const result = out.join("\n");
if (strip(result) !== strip(src)) { console.error("REFUSED: the code changed under the trim"); process.exit(1); }
console.log(`${relFile}: ${moved} runs moved (${kept} kept by --keep), ${saved.toLocaleString("en-US")} bytes saved; ${Buffer.byteLength(src)} -> ${Buffer.byteLength(result)}`);
if (!DRY) {
  writeFileSync(file, result);
  if (sections.length) writeFileSync(DOC, `${docText.replace(/\n*$/, "\n")}\n${sections.join("\n")}`);
}
