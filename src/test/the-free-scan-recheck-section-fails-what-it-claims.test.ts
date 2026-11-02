// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzz-free-scan-wave-recheck CAN FAIL EVERY CLAIM IT MAKES
 * (the free-scan wave's recheck on a third corpus, 2026-11-01).
 *
 * The section runs against a fake curl serving the real en.json as the
 * English chunk:
 *   - a good deploy prints PASS for both claims and no FAIL;
 *   - a bundle from before the recheck names every string it lacks and every
 *     withdrawn claim it still serves;
 *   - a bundle whose layout moved, and a gateway's HTML page, print FAIL,
 *     never a crash into silence;
 *   - every call is a GET, the British chunk is never read, and the
 *     publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION_NAME = "99zzzzz-free-scan-wave-recheck.sh";
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d", SECTION_NAME), "utf8");
const EN = readFileSync(resolve(ROOT, "src/i18n/locales/en.json"), "utf8");
const KEY = "pk_test_SECRET_marker_fsx";
const S = "https://site\\.test";

type Route = { match: string; status?: number; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")o=a[++i];else if(x==="-D")i++;
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")i++;else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdfsx-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

function routes(o: { chunk?: string; entry?: string } = {}): Route[] {
  return [
    { match: `^GET ${S}/$`, body: '<html><script type="module" src="/assets/index-abc123.js"></script></html>' },
    { match: `^GET ${S}/assets/index-abc123\\.js$`, body: o.entry ?? 'import("./rb-en_all-xyz789.js");import("./en-GB-qq11.js");' },
    { match: `^GET ${S}/assets/rb-en_all-xyz789\\.js$`, body: o.chunk ?? `export default ${EN};` },
    { match: `^GET ${S}/assets/en-GB-qq11\\.js$`, body: `export default ${EN};` },
  ];
}
const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");

describe("the section's name", () => {
  it("sorts after the review section in byte order and with the dash ignored", () => {
    const review = "99zzzz-free-scan-wave-review.sh";
    expect(SECTION_NAME > review).toBe(true);
    expect(SECTION_NAME.replace(/-/g, "") > review.replace(/-/g, "")).toBe(true);
  });
});

describe("a good deploy", () => {
  const { lines, calls, out } = run(routes());
  it("prints PASS for both claims and no FAIL", () => {
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
    expect(has(lines, "PASS", /^PASS {2}FX1 the English strings \(rb-en_all-xyz789\.js\) carry/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /^PASS {2}FX2 .* carry none of the withdrawn claims/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /FX3 the engine half of the recheck needs a scan/), show(lines)).toBe(true);
  });
  it("every line is a verdict, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
  it("every call is a GET, and the British chunk is never read", () => {
    expect(calls.filter((c) => !/^curl\tGET /.test(c))).toEqual([]);
    expect(calls.some((c) => /en-GB-/.test(c))).toBe(false);
  });
});

describe("each regression prints FAIL", () => {
  it("a bundle from before the recheck names every string it lacks and every withdrawn claim it serves", () => {
    const old = JSON.parse(EN);
    const h = old.freeResults.builderHandoff;
    h.ctaRewrites_other = "Open in builder with {{count}} rewrites applied →";
    h.bodyRewrites_other = "Open the free builder with your resume loaded and this report's {{count}} bullet rewrites already applied, then export.";
    old.freeReportSignup.body = "Create a free account and get 15 free scans a day instead of 7.";
    old.freeResults.scorePotential.basis = "Your score plus the top quick wins above added.";
    delete old.reportInsights.findings.items;
    const chunk = `export default ${JSON.stringify(old).replace(/Little left to gain/g, "").replace(/screeners cannot contact you/g, "")};`;
    const { lines } = run(routes({ chunk }));
    const fx1 = lines.find((l) => l.startsWith("FAIL  FX1")) ?? "";
    expect(fx1, show(lines)).toMatch(/S13-038 hand-off button, S13-038 hand-off body, S13-094 sign-up nudge, S13-058 Improvement Potential level, S13-058 Score Potential basis, S13-122 findings index/);
    const fx2 = lines.find((l) => l.startsWith("FAIL  FX2")) ?? "";
    expect(fx2, show(lines)).toMatch(/S13-038 rewrites applied button, S13-038 already-applied body, S13-094 typed allowance/);
  });
  it("a bundle whose layout moved is a FAIL that says so, never a pass over nothing", () => {
    const { lines } = run(routes({ entry: 'import("./en-GB-qq11.js");' }));
    expect(has(lines, "FAIL", /FX1 no English chunk the entry \/assets\/index-abc123\.js names holds resumeBuilder's strings/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
  });
  it("a gateway's HTML page in place of every answer prints a FAIL, never a crash", () => {
    const { lines } = run([{ match: ".", status: 502, body: "<html><body>502 Bad Gateway</body></html>" }]);
    expect(lines.filter((l) => l.startsWith("FAIL")).length, show(lines)).toBeGreaterThanOrEqual(1);
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l)), show(lines)).toBe(true);
  });
});
