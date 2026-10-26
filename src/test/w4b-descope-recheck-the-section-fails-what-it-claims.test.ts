// @vitest-environment node
/**
 * SECTION 92 (THE SECOND RECHECK OF THE DESCOPE) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-descope-recheck.sh is what the owner reads
 * after wave 4 deploys. A PASS is worth something only if a regression could
 * have turned it into a FAIL (verify-deploy.d/README), so the section runs
 * here in bash against a fake curl, with the real build_ge cut from the
 * verifier: a healthy deploy prints no FAIL; an older build, the old
 * /freelance-boost bake, a sitemap that still lists it, and the old llms.txt
 * each print FAIL; and the section only ever sends OPTIONS and GET.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-descope-recheck.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const LLMS_NOW = readFileSync(resolve(ROOT, "public/llms.txt"), "utf8");

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,key+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,r.body??"");else if(!o)out+=(r.body??"");
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-92z-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n` + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const has = (lines: string[], s: "PASS" | "FAIL", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

const FN = "https://p\\.supabase\\.co/functions/v1";
const BUILDS: Array<[string, number]> = [["agent-mcp", 36], ["public-api", 36], ["create-agent-checkout", 17], ["create-pass-checkout", 17], ["create-product-checkout", 26]];
const pad = "x".repeat(600);
const BAKE_NOW = `<html><head><meta name="robots" content="noindex, follow" /><title>Freelance Boost is no longer sold</title></head><body><h1>Freelance Boost is no longer sold</h1>${pad}</body></html>`;
const BAKE_OLD = `<html><head><meta name="robots" content="index, follow" /><title>Freelance Boost — Turn Projects Into Resume Experience</title></head><body>Freelance Boost translates the work you have already done ... in about 15 seconds.${pad}</body></html>`;
const url = (p: string) => `<url><loc>https://resumebooster.work${p}</loc></url>`;
const SITEMAP_NOW = `<?xml version="1.0"?><urlset>${["/", "/pricing", "/builder", "/jobs"].map(url).join("")}${pad}</urlset>`;
const SITEMAP_OLD = `<?xml version="1.0"?><urlset>${["/", "/pricing", "/freelance-boost", "/builder"].map(url).join("")}${pad}</urlset>`;
const LLMS_OLD = `${pad}${pad}\nPaid tools are one-time purchases: resume rewrites, cover letters, interview coaching, Freelance Boost.\n- [Freelance Boost](https://resumebooster.work/freelance-boost): ... $29 one-time.\n`;

function healthy(over: { build?: (fn: string, n: number) => string; bake?: string; sitemap?: string; llms?: string } = {}): Route[] {
  const routes: Route[] = BUILDS.map(([fn, n]) => ({ match: `^OPTIONS ${FN}/${fn}$`, headers: { "x-fn-build": over.build ? over.build(fn, n) : `${fn}.2026-10-11.${n}` } }));
  routes.push({ match: "^GET https://site\\.test/freelance-boost$", body: over.bake ?? BAKE_NOW });
  routes.push({ match: "^GET https://site\\.test/sitemap\\.xml$", body: over.sitemap ?? SITEMAP_NOW });
  routes.push({ match: "^GET https://site\\.test/llms\\.txt$", body: over.llms ?? LLMS_NOW });
  return routes;
}

describe("section 92, the second recheck of the descope", () => {
  it("a healthy deploy prints five build PASS lines and four site PASS lines, and only reads", () => {
    const { lines, calls } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS {2}\S+ x-fn-build = /.test(l))).toHaveLength(5);
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(9);
    expect(calls.every((c) => /^(OPTIONS|GET) /.test(c)), calls.join("\n")).toBe(true);
    expect(calls).toHaveLength(8);
  });

  it("the shipped llms.txt is what the healthy run reads, so the section passes on the file this branch publishes", () => {
    expect(LLMS_NOW).toMatch(/Inside ChatGPT, your AI reads the application form only when the employer uses Greenhouse or Recruitee\./);
  });

  it("an older build of each reads FAIL, and a missing header too", () => {
    const { lines } = run(healthy({ build: (fn, n) => `${fn}.2026-10-11.${n - 1}` }));
    for (const [fn, n] of BUILDS) expect(has(lines, "FAIL", new RegExp(`^FAIL {2}${fn} x-fn-build = ${fn}\\.2026-10-11\\.${n - 1}`)), show(lines)).toBe(true);
    const none = run(healthy({ build: () => "" }));
    expect(fails(none.lines).filter((l) => /carries no x-fn-build/.test(l))).toHaveLength(5);
  });

  it("the old /freelance-boost bake reads FAIL", () => {
    const { lines } = run(healthy({ bake: BAKE_OLD }));
    expect(has(lines, "FAIL", /crawler copy of \/freelance-boost/), show(lines)).toBe(true);
  });

  it("a sitemap that still lists /freelance-boost reads FAIL, and so does no sitemap", () => {
    expect(has(run(healthy({ sitemap: SITEMAP_OLD })).lines, "FAIL", /sitemap\.xml names no \/freelance-boost/)).toBe(true);
    expect(has(run(healthy({ sitemap: "" })).lines, "FAIL", /no sitemap read/)).toBe(true);
  });

  it("the old llms.txt reads FAIL on both lines", () => {
    const { lines } = run(healthy({ llms: LLMS_OLD }));
    expect(has(lines, "FAIL", /llms\.txt sells no cut product/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /inside ChatGPT the form is read only/), show(lines)).toBe(true);
  });
});
