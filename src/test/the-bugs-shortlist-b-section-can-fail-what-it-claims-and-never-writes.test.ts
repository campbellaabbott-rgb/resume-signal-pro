// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE BUG ROUND'S SHORTLIST-B VERIFY SECTION FAILS WHAT IT CLAIMS, AND NEVER
 * WRITES (S14X-164).
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-shortlist-b.sh is run against a fake
 * curl that answers the one preflight it sends and logs every call:
 *   - before the paste (shortlist-evaluate on an earlier build) the build and
 *     the item line print INFO, the repo proof R0 PASSes, and nothing FAILs;
 *   - this round's build, or a later one, PASSes the build and the item line;
 *   - a preflight with no build FAILs the build line;
 *   - a check that knows English only (as it did before this round), one that
 *     flags ordinary lines, and a scorer that no longer runs the check on the
 *     resume each FAIL R0 and the item line, before the paste and after it;
 *   - a module this node cannot load leaves R0 INFO and the item judged by
 *     the build alone;
 *   - only the preflight is sent, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-shortlist-b.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_shortlist_b";

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const build=process.env.VD_BUILD||"";
const ok=method==="OPTIONS"&&/\\/functions\\/v1\\/shortlist-evaluate$/.test(url);
const hdr="HTTP/2 "+(ok?200:404)+"\\r\\n"+(ok&&build?"x-fn-build: "+build+"\\r\\n":"")+"\\r\\n";
if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,"");
`;

/** The check as it was before this round: English phrasings only. */
const ENGLISH_ONLY = `export function plantedInstructions(t) {
  const out = [];
  if (/\\b(ignore|disregard|forget|override)\\b[^.\\n]{0,30}\\b(previous|prior|above|earlier|all|any|your|the)\\b[^.\\n]{0,20}\\b(instructions?|prompts?|rules|guidelines|directions)\\b/i.test(t)) out.push("asks to ignore earlier instructions");
  if (/\\b(give|assign|rate|score|rank|mark)\\b[^.\\n]{0,40}\\b(candidate|resume|applicant|profile|this person)\\b[^.\\n]{0,40}\\b(100|perfect|maximum|highest|top)\\b/i.test(t)) out.push("asks for a score");
  return out;
}
`;
/** A check that flags every line it reads. */
const FLAGS_ALL = "export function plantedInstructions() { return [\"asks for a score\"]; }\n";
/** The scorer, with the check imported but never run on the resume. */
const UNWIRED_FN = `import { fenceUntrusted, plantedInstructions } from "../_shared/planted-instructions.ts";
const planted = [];
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Opts = { module?: { name: string; text: string }; fnSrc?: string };
function run(build: string | null, o: Opts = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbsb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "calls.log"), "");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_CALLS: join(dir, "calls.log"), VD_BUILD: build ?? "",
  };
  if (o.module) {
    writeFileSync(join(dir, o.module.name), o.module.text);
    env.VDBSB_MODULE = join(dir, o.module.name);
  }
  if (o.fnSrc !== undefined) {
    writeFileSync(join(dir, "index.ts"), o.fnSrc);
    env.VDBSB_FN_SRC = join(dir, "index.ts");
  }
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 85_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const NEW = "shortlist-evaluate.2026-11-13.1";
const PART_A = "shortlist-evaluate.2026-11-12.1";
const LIVE_TODAY = "shortlist-evaluate.2026-11-09.2";

const verdict = (lines: string[], id: string) => lines.find((l) => l.slice(6).startsWith(`${id} `))?.slice(0, 4) ?? "none";
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("section 99zzzzzzz (bug round part B, lane shortlist-b)", () => {
  it("before the paste the build and the item are INFO, the repo proof PASSes, and only the preflight is sent", () => {
    for (const build of [LIVE_TODAY, PART_A]) {
      const { lines, calls, out } = run(build);
      expect(fails(lines), out).toEqual([]);
      expect([verdict(lines, "B"), verdict(lines, "R0"), verdict(lines, "S14X-164")], out).toEqual(["INFO", "PASS", "INFO"]);
      expect(calls).toEqual(["curl\tOPTIONS https://p.supabase.co/functions/v1/shortlist-evaluate"]);
      expect(out).not.toContain(KEY);
    }
  });

  it("this round's build, or a later one, PASSes the build and the item", () => {
    for (const build of [NEW, "shortlist-evaluate.2026-11-20.1"]) {
      const { lines, out } = run(build);
      expect(fails(lines), out).toEqual([]);
      expect([verdict(lines, "B"), verdict(lines, "R0"), verdict(lines, "S14X-164")], out).toEqual(["PASS", "PASS", "PASS"]);
    }
  });
});

describe("each claim can FAIL", () => {
  it("a preflight that names no build", () => {
    const { lines, out } = run(null);
    expect(verdict(lines, "B"), out).toBe("FAIL");
    expect(fails(lines), out).toHaveLength(1);
  });

  it("a check that knows English only, before the paste and after it", () => {
    for (const build of [LIVE_TODAY, NEW]) {
      const { lines, out } = run(build, { module: { name: "planted.mjs", text: ENGLISH_ONLY } });
      expect(verdict(lines, "R0"), out).toBe("FAIL");
      expect(verdict(lines, "S14X-164"), out).toBe("FAIL");
      expect(out).toMatch(/the planted line in de, fr, es, pt, nl, hi, tl, zh, ja is not flagged/);
    }
  });

  it("a check that flags ordinary lines", () => {
    const { lines, out } = run(NEW, { module: { name: "planted.mjs", text: FLAGS_ALL } });
    expect(verdict(lines, "R0"), out).toBe("FAIL");
    expect(verdict(lines, "S14X-164"), out).toBe("FAIL");
    expect(out).toMatch(/12 ordinary line\(s\) are flagged/);
  });

  it("a scorer that no longer runs the check on the resume", () => {
    const { lines, out } = run(NEW, { fnSrc: UNWIRED_FN });
    expect(verdict(lines, "R0"), out).toBe("FAIL");
    expect(verdict(lines, "S14X-164"), out).toBe("FAIL");
    expect(out).toMatch(/does not import plantedInstructions .* and run it on resumeText/);
  });

  it("a module with no plantedInstructions export", () => {
    const { lines, out } = run(NEW, { module: { name: "planted.mjs", text: "export const other = 1;\n" } });
    expect(verdict(lines, "R0"), out).toBe("FAIL");
    expect(verdict(lines, "S14X-164"), out).toBe("FAIL");
  });
});

describe("a module this node cannot load", () => {
  it("leaves R0 INFO and judges the item by the build alone", () => {
    const after = run(NEW, { module: { name: "planted.unknownext", text: FLAGS_ALL } });
    expect([verdict(after.lines, "R0"), verdict(after.lines, "S14X-164")], after.out).toEqual(["INFO", "PASS"]);
    expect(fails(after.lines), after.out).toEqual([]);
    const before = run(LIVE_TODAY, { module: { name: "planted.unknownext", text: FLAGS_ALL } });
    expect([verdict(before.lines, "R0"), verdict(before.lines, "S14X-164")], before.out).toEqual(["INFO", "INFO"]);
  });
});
