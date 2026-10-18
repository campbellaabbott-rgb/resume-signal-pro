#!/usr/bin/env node
// THE VERIFIER'S TALLY (S12-163). scripts/verify-deploy.sh pipes everything it
// prints through this file, which passes every line straight on and then
// judges the run itself:
//
//   - a section that printed no PASS and no FAIL line is said: nothing in it
//     could fail, so it proved nothing (a node script that crashed on an HTML
//     body printed nothing at all, and section 1 simply vanished);
//   - a stack frame, a thrown error or a shell error inside a section is a
//     script error, and its section is a FAIL (other stray lines are named);
//   - when the positive control (section 0) did not PASS, every PASS line of
//     the run is void: an all-failing run used to print 48 PASS.
//
// The exit status is 1 when the run holds a FAIL of any kind, 0 otherwise.
// Importing this file runs nothing; `tally(lines)` is the pure judge.
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERDICT = /^(PASS|FAIL|INFO) {2}/;
const CONTROL = /^(PASS|FAIL) {2}positive control:/;
/** A stray line that is a script dying: a stack frame, a thrown error, a shell error. */
const CRASH = /^\s+at |^\S*(Syntax|Reference|Type|Range)Error\b|^Error\b|Unexpected token|Cannot find module|node:internal|command not found|syntax error|unbound variable|^\s*throw /;

/**
 * Judge a run's printed lines. Pure.
 *
 *   returns { pass, fail, info, sections: [{ id, title, pass, fail, info, stray: [line], crash: [line] }],
 *             control: "pass" | "fail" | "missing", verdicts: [line], failed: boolean }
 *
 * `verdicts` are the tally's own lines, each starting PASS, FAIL or INFO.
 */
export function tally(lines) {
  const sections = [];
  let cur = { id: "-", title: "before the first section", pass: 0, fail: 0, info: 0, stray: [], crash: [] };
  let control = "missing";
  for (const raw of lines ?? []) {
    const line = String(raw).replace(/\r$/, "");
    if (!line.trim()) continue;
    if (line.startsWith("== ")) {
      const title = line.replace(/^== /, "").replace(/ ==\s*$/, "").trim();
      cur = { id: (/^([^\s:]+?)\.?(?:\s|:|$)/.exec(title) ?? [null, title])[1], title, pass: 0, fail: 0, info: 0, stray: [], crash: [] };
      sections.push(cur);
      continue;
    }
    if (line === "done.") continue;
    const v = VERDICT.exec(line);
    if (!v) { (CRASH.test(line) ? cur.crash : cur.stray).push(line); continue; }
    cur[v[1].toLowerCase()]++;
    const c = CONTROL.exec(line);
    if (c && control !== "fail") control = c[1] === "PASS" ? "pass" : "fail";
  }
  const pass = sections.reduce((n, s) => n + s.pass, 0);
  const fail = sections.reduce((n, s) => n + s.fail, 0);
  const info = sections.reduce((n, s) => n + s.info, 0);
  const verdicts = [];
  for (const s of [cur.crash.length && !sections.includes(cur) ? cur : null, ...sections].filter(Boolean)) {
    if (s.crash.length) verdicts.push(`FAIL  section ${s.id} hit a script error (${s.crash.length} line(s)), so its verdicts are incomplete: ${s.crash[0].trim().slice(0, 160)}`);
    if (!s.pass && !s.fail && !s.info) verdicts.push(`FAIL  section ${s.id} printed no verdict: its probe died before it could say PASS or FAIL (${s.title.slice(0, 80)})`);
    else if (!s.pass && !s.fail) verdicts.push(`INFO  section ${s.id} printed only INFO: nothing in it could fail this run (${s.title.slice(0, 80)})`);
    if (s.stray.length) verdicts.push(`INFO  section ${s.id} printed ${s.stray.length} line(s) that are not verdicts, e.g. ${s.stray[0].slice(0, 120)}`);
  }
  if (control === "missing") verdicts.push("FAIL  no positive control ran (section 0): nothing says production answered as itself, so no PASS line here can be trusted");
  else if (control === "fail") verdicts.push(`FAIL  the positive control failed: production did not answer as itself, so the ${pass} PASS line(s) above prove nothing`);
  const failed = fail > 0 || verdicts.some((l) => l.startsWith("FAIL"));
  return { pass, fail, info, sections, control, verdicts, failed };
}

async function main() {
  const lines = [];
  let buf = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      process.stdout.write(`${line}\n`);
      lines.push(line);
    }
  }
  if (buf) { process.stdout.write(`${buf}\n`); lines.push(buf); }
  const t = tally(lines);
  process.stdout.write(`== tally ==\n`);
  for (const l of t.verdicts) process.stdout.write(`${l}\n`);
  process.stdout.write(`INFO  ${t.pass} PASS, ${t.fail} FAIL, ${t.info} INFO across ${t.sections.length} sections; positive control ${t.control}\n`);
  process.exitCode = t.failed ? 1 : 0;
}

const isEntry = (() => { try { return realpathSync(resolve(process.argv[1] ?? "")) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isEntry) await main();
