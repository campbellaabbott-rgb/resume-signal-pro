// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-mail-b CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * FALSELY BEFORE THE PASTE, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-mail-b.sh judges part B's mail lane
 * (S14X-170): send-scan-report's build, and, read offline from the repo, what
 * the scan-report mails say an outcome answer is for. Run here against a fake
 * curl and fixture copy tables:
 *   - production before the part-B paste (part A's 2026-11-12.1, or the cost
 *     wave's 2026-11-09.1) prints INFO for the build and the item, PASS for the
 *     repo code, and no FAIL: part A's stamp is not this lane's build;
 *   - a good deploy (2026-11-13.1, or any later build) prints PASS for all
 *     three lines and no FAIL;
 *   - each regression prints FAIL: a preflight with no build; a copy table
 *     whose French day-14 line, English report ask or English preview is the
 *     old one, or which lost a language; the table as it stood before the fix;
 *     an index.ts that stopped printing the day-14 line; a copy.ts that does
 *     not load;
 *   - the only request is one OPTIONS preflight to send-scan-report, and the
 *     key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-mail-b.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bugs_mail_b";
const COPY_URL = pathToFileURL(resolve(ROOT, "supabase/functions/send-scan-report/copy.ts")).href;
const INDEX = readFileSync(resolve(ROOT, "supabase/functions/send-scan-report/index.ts"), "utf8");

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const build=process.env.VD_BUILD;
const hdr="HTTP/2 200\\r\\n"+(build?"x-fn-build: "+build+"\\r\\n":"")+"access-control-allow-origin: *\\r\\n\\r\\n";
if(D==="-")process.stdout.write(hdr);else if(D)fs.writeFileSync(D,hdr);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Run = { lines: string[]; calls: string[]; out: string };
type Opts = { build?: string | null; copy?: string; index?: string };

/**
 * A copy table built from the shipped one: `edit` is JS run on T (a shallow
 * copy of each language's entry) before it is exported, or a whole module.
 */
const edited = (edit: string) =>
  `import { REPORT_COPY as R } from ${JSON.stringify(COPY_URL)};\n` +
  "const T = Object.fromEntries(Object.entries(R).map(([l, c]) => [l, { ...c }]));\n" +
  `${edit}\nexport const REPORT_COPY = T;\n`;

function run(o: Opts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), "vdbmb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  const build = o.build === undefined ? "send-scan-report.2026-11-13.1" : o.build;
  if (build) env.VD_BUILD = build; else delete env.VD_BUILD;
  if (o.copy !== undefined) { writeFileSync(join(dir, "copy.mjs"), o.copy); env.VDBMB_COPY = join(dir, "copy.mjs"); } else delete env.VDBMB_COPY;
  if (o.index !== undefined) { writeFileSync(join(dir, "index.ts"), o.index); env.VDBMB_FN_SRC = join(dir, "index.ts"); } else delete env.VDBMB_FN_SRC;
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 90_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const line = (r: Run, verdict: string, id: string) => r.lines.find((l) => l.startsWith(verdict.padEnd(5) + " " + id + " "));
const show = (r: Run) => r.lines.join("\n");
const fails = (r: Run) => r.lines.filter((l) => l.startsWith("FAIL"));

describe("before the part-B paste", () => {
  for (const build of ["send-scan-report.2026-11-12.1", "send-scan-report.2026-11-09.1"]) {
    it(`${build} prints INFO for the build and the item, PASS for the repo code, and no FAIL`, () => {
      const r = run({ build });
      expect(fails(r), show(r)).toEqual([]);
      expect(line(r, "INFO", "B"), show(r)).toContain(build);
      expect(line(r, "PASS", "R0"), show(r)).toBeTruthy();
      expect(line(r, "INFO", "S14X-170"), show(r)).toMatch(/waits for the part-B paste/);
    });
  }
});

describe("after a good deploy", () => {
  for (const build of ["send-scan-report.2026-11-13.1", "send-scan-report.2026-12-01.1"]) {
    it(`${build} passes the build, the repo code and the item`, () => {
      const r = run({ build });
      expect(fails(r), show(r)).toEqual([]);
      expect(line(r, "PASS", "B"), show(r)).toContain(build);
      expect(line(r, "PASS", "R0"), show(r)).toBeTruthy();
      expect(line(r, "PASS", "S14X-170"), show(r)).toMatch(/R0 proves the code/);
    });
  }
});

describe("each regression fails", () => {
  it("a preflight with no build header", () => {
    const r = run({ build: null });
    expect(line(r, "FAIL", "B"), show(r)).toMatch(/carries no x-fn-build/);
    expect(line(r, "INFO", "S14X-170"), show(r)).toBeTruthy();
  });

  it("the French day-14 line back to the public benchmarks", () => {
    const r = run({ copy: edited('T.fr.day14Why = "Chaque réponse affine les repères publics : mesurer ce qui marche vraiment, c\'est tout le produit.";') });
    expect(line(r, "FAIL", "R0"), show(r)).toMatch(/fr day14Why/);
    expect(line(r, "FAIL", "S14X-170"), show(r)).toBeTruthy();
    expect(line(r, "PASS", "S14X-170"), show(r)).toBeUndefined();
  });

  it("the English report ask back to measuring", () => {
    const r = run({ copy: edited('T.en.outcomeAsk = "Applied with this resume? One click helps us measure which scores actually land interviews (anonymous):";') });
    expect(line(r, "FAIL", "R0"), show(r)).toMatch(/en outcomeAsk/);
    expect(line(r, "FAIL", "S14X-170"), show(r)).toBeTruthy();
  });

  it("the English preview back to Projected", () => {
    const r = run({ copy: edited("T.en.projected = (n) => `↗ Projected ~${n} after your fix plan`;") });
    expect(line(r, "FAIL", "R0"), show(r)).toMatch(/en projected/);
  });

  it("a table that lost a language", () => {
    const r = run({ copy: edited("delete T.hi;") });
    expect(line(r, "FAIL", "R0"), show(r)).toMatch(/hi is missing/);
  });

  it("the table as it stood before the fix", () => {
    const r = run({ copy: edited([
      "T.en.outcomeAsk = \"Applied with this resume? One click helps us measure which scores actually land interviews (anonymous):\";",
      "T.en.day6Outcome = (yes, no) => `And if you've applied anywhere with it, one anonymous click tells us how it went — that's how we measure what actually works: ${yes(\"got interviews\")} · ${no(\"no response\")}.`;",
      "T.en.day14Why = \"Every answer sharpens the public benchmarks — measuring what actually works is the whole product.\";",
      "T['en-GB'] = { ...T['en-GB'], day6Outcome: T.en.day6Outcome, day14Why: T.en.day14Why, outcomeAsk: \"Applied with this CV? One click helps us measure which scores actually land interviews (anonymous):\" };",
      "T.de.day14Why = \"Jede Antwort schärft die öffentlichen Vergleichswerte — zu messen, was wirklich funktioniert, ist das ganze Produkt.\";",
      "T.tl.day14Why = \"Pinapatalas ng bawat sagot ang mga pampublikong benchmark — ang pagsukat sa talagang gumagana ang buong produkto.\";",
    ].join("\n")) });
    const r0 = line(r, "FAIL", "R0");
    expect(r0, show(r)).toMatch(/en outcomeAsk/);
    expect(r0, show(r)).toMatch(/and \d+ more/);
    expect(line(r, "FAIL", "S14X-170"), show(r)).toBeTruthy();
  });

  it("an index.ts that stopped printing the day-14 line", () => {
    const index = INDEX.split("${c.day14Why}").join("");
    expect(index).not.toBe(INDEX);
    const r = run({ index });
    expect(line(r, "FAIL", "R0"), show(r)).toMatch(/no longer prints/);
  });

  it("a copy.ts that does not load", () => {
    const r = run({ copy: 'throw new Error("the table did not build");\n' });
    expect(line(r, "FAIL", "R0"), show(r)).toMatch(/gave no REPORT_COPY table/);
    expect(line(r, "FAIL", "S14X-170"), show(r)).toBeTruthy();
  });
});

describe("it never writes", () => {
  it("asks one OPTIONS preflight of send-scan-report and never prints the key", () => {
    const r = run();
    expect(r.calls.length, r.calls.join("\n")).toBe(1);
    expect(r.calls[0]).toMatch(/^curl\tOPTIONS https:\/\/p\.supabase\.co\/functions\/v1\/send-scan-report\t/);
    expect(r.out).not.toContain(KEY);
    expect(r.out).not.toContain("SECRET");
  });
});
