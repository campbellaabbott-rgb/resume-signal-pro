// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-free-scan-page-b CAN FAIL WHAT IT CLAIMS,
 * NEVER FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-page-b.sh judges
 * RC-S13-018 (the report's hero and industry card name the industry with the
 * select's label) from the report chunk /resume-checker loads. Run here
 * against a fake curl:
 *   - production as it is today (the report chunk cut to its tells: the
 *     card's own label map, the hero's title-casing, neither of the lane's
 *     marks) prints no FAIL, and the claim says 'not yet published';
 *   - the lane's build prints PASS for the stage and the claim;
 *   - each regression prints FAIL for its own line (the map back, the
 *     title-casing back, one mark without the other), and a layout the
 *     section cannot read is a FAIL, not a quiet pass;
 *   - every request is a GET, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-page-b.sh"), "utf8");
const KEY = "pk_test_SECRET_marker_bfspb";
const S = "https://site\\.test";

type Route = { match: string; status?: number; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")o=a[++i];else if(x==="-D")i++;
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbfspb-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// The chunks as production serves them today (2026-11-17: Index-B_0ILwfg.js,
// FreeKeywordResults-vQUUaD0p.js), cut to their tells ...
const PAGE = '<html><head><script type="module" crossorigin src="/assets/index-E1.js"></script><link rel="modulepreload" crossorigin href="/assets/Index-A1.js"></head></html>';
const IDX = 'import{a as e}from"./index-E1.js";const F=()=>import("./FreeKeywordResults-F1.js");';
const HERO_OLD = 'function Hero({industry:r}){const{t:h}=Q(),E=r.replace(/_/g," ").replace(/\\b\\w/g,V=>V.toUpperCase());return e.jsxs("div",{children:[h("scoreHero.analysisComplete"),e.jsx("span",{className:"text-foreground/80",children:E})]})}';
const CARD_MAP = 'const Ni=i=>{const t={technology:"Technology",software:"Software/Tech",sales:"Sales",hr:"Human Resources",humanResources:"Human Resources",creative:"Creative/Design",general:"General"};return t[i]?t[i]:i};';
const CARD_OLD = CARD_MAP + 'function Card({industry:n}){const{t:o}=Q();return e.jsxs("div",{children:[e.jsx("span",{className:"font-bold text-foreground text-lg",children:Ni(n)}),o("industryConfidence.isThisRight")]})}';
// The select's label function rides in the same chunk, before and after.
const LABEL_FN = 'const gc={hr:"HR",general:"General / Other"};function Ie(r,i){if(i&&/^[a-z0-9_]+$/i.test(r))for(const s of[`freeScanPage.industry.${r}`,`analysisResults.enum.industry.${r}`]){const c=i(s);if(typeof c=="string"&&c&&c!==s)return c}const t=gc[r];return t||r.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]+/g," ").trim()}';
// The owner digest keeps the client keyword config labels: never the card's map.
const DIGEST = 'const Av=[{value:"business_development",label:"Business Development"},{value:"general",label:"General / Other"}];';
const OLD_FKR = LABEL_FN + DIGEST + HERO_OLD + CARD_OLD;

// ... and as this branch builds them.
const HERO_NEW = 'function Hero({industry:r}){const{t:p}=F(),C=Ie(r,p);return e.jsxs("div",{children:[p("scoreHero.analysisComplete"),e.jsx("span",{"data-hero-industry":!0,className:"text-foreground/80",children:C})]})}';
const CARD_NEW = 'function Card({industry:n}){const{t:o}=F(),w=E=>Ie(E,o);return e.jsxs("div",{children:[e.jsx("span",{"data-industry-label":!0,className:"font-bold text-foreground text-lg",children:w(n)}),o("industryConfidence.isThisRight")]})}';
const NEW_FKR = LABEL_FN + DIGEST + HERO_NEW + CARD_NEW;

function routes(fkr: string | null, o: { page?: string; idx?: string } = {}): Route[] {
  return [
    { match: `^GET ${S}/resume-checker$`, body: o.page ?? PAGE },
    { match: `^GET ${S}/assets/Index-A1\\.js$`, body: o.idx ?? IDX },
    ...(fkr === null ? [] : [{ match: `^GET ${S}/assets/FreeKeywordResults-F1\\.js$`, body: fkr }]),
  ];
}

const line = (lines: string[], id: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${id.replace(/[-.]/g, "\\$&")} `).test(l));
const verdict = (lines: string[], id: string) => line(lines, id).map((l) => l.slice(0, 4));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("today's production", () => {
  const { lines, calls, out } = run(routes(OLD_FKR));

  it("prints no FAIL: the stage and the claim are INFO, 'not yet published', and name what is still there", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L0"), show(lines)).toEqual(["INFO"]);
    expect(verdict(lines, "L1"), show(lines)).toEqual(["INFO"]);
    expect(verdict(lines, "RC-S13-018"), show(lines)).toEqual(["INFO"]);
    const claim = line(lines, "RC-S13-018")[0];
    expect(claim).toMatch(/not yet published/);
    expect(claim).toContain("Software/Tech");
    expect(claim).toMatch(/title-cases a raw id/);
    expect(verdict(lines, "X1")).toEqual(["INFO"]);
  });

  it("sends only GETs, and never prints the key", () => {
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c, c).toMatch(/^curl\tGET https:\/\/site\.test\//);
    expect(out).not.toContain(KEY);
  });

  it("a page whose old tells are already gone, with no mark, says so and still waits", () => {
    const { lines: l } = run(routes(LABEL_FN + DIGEST + HERO_NEW.replace('"data-hero-industry":!0,', "") + CARD_NEW.replace('"data-industry-label":!0,', "")));
    expect(fails(l), show(l)).toEqual([]);
    expect(line(l, "RC-S13-018")[0], show(l)).toMatch(/^INFO .*not yet published \(already holds today/);
  });
});

describe("the lane's build", () => {
  it("passes the stage and the claim, and fails nothing", () => {
    const { lines, calls } = run(routes(NEW_FKR));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L1"), show(lines)).toEqual(["PASS"]);
    expect(verdict(lines, "RC-S13-018"), show(lines)).toEqual(["PASS"]);
    for (const c of calls) expect(c, c).toMatch(/^curl\tGET /);
  });
});

describe("each regression fails its own line", () => {
  it("the card's own label map back in a published report", () => {
    for (const pair of ['software:"Software/Tech"', 'hr:"Human Resources"', 'humanResources:"Human Resources"', 'creative:"Creative/Design"']) {
      const { lines } = run(routes(NEW_FKR + `const Ni=i=>({technology:"Technology",${pair}})[i];`));
      expect(verdict(lines, "RC-S13-018"), `${pair}\n${show(lines)}`).toEqual(["FAIL"]);
      expect(line(lines, "RC-S13-018")[0]).toContain(pair);
      expect(verdict(lines, "L1")).toEqual(["PASS"]);
    }
  });

  it("the hero's title-casing back in a published report", () => {
    const { lines } = run(routes(NEW_FKR + 'const E=r.replace(/_/g," ").replace(/\\b\\w/g,V=>V.toUpperCase());'));
    expect(verdict(lines, "RC-S13-018"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "RC-S13-018")[0]).toMatch(/title-cases a raw id/);
  });

  it("one mark without the other", () => {
    for (const [mark, other] of [['"data-hero-industry":!0,', "card"], ['"data-industry-label":!0,', "hero"]] as const) {
      const { lines } = run(routes(NEW_FKR.replace(mark, "")));
      expect(verdict(lines, "L1"), show(lines)).toEqual(["FAIL"]);
      expect(line(lines, "L1")[0]).toContain(`only the ${other}`);
    }
  });

  it("a half-published report with the old hero is judged, not waited for", () => {
    const { lines } = run(routes(LABEL_FN + HERO_OLD + CARD_NEW));
    expect(verdict(lines, "L1"), show(lines)).toEqual(["FAIL"]);
    expect(verdict(lines, "RC-S13-018"), show(lines)).toEqual(["FAIL"]);
  });
});

describe("a layout the section cannot read is a FAIL", () => {
  const cases: Array<[string, Route[], RegExp]> = [
    ["no scanner chunk on the page", routes(NEW_FKR, { page: "<html></html>" }), /scanner chunk/],
    ["the scanner names no report chunk", routes(NEW_FKR, { idx: 'import{a as e}from"./index-E1.js";' }), /names no FreeKeywordResults/],
    ["the report chunk does not answer", routes(null), /no body/],
    ["the hero moved out of the report chunk", routes(CARD_NEW + LABEL_FN), /score hero/],
    ["the card moved out of the report chunk", routes(HERO_NEW + LABEL_FN), /industry card/],
  ];
  for (const [name, r, why] of cases) {
    it(name, () => {
      const { lines } = run(r);
      expect(verdict(lines, "L0"), show(lines)).toEqual(["FAIL"]);
      expect(line(lines, "L0")[0]).toMatch(why);
      expect(verdict(lines, "RC-S13-018"), "nothing is judged over an unread layout").toEqual([]);
    });
  }
});
