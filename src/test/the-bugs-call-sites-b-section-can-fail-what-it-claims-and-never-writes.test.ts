// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-call-sites-b CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-call-sites-b.sh judges part B's
 * call-sites lane of the 2026-11-08 bug round: it walks every chunk the
 * published app can load and counts the figures and dates left to the
 * browser's language (S14X-255) and the .txt uploads read as UTF-8 only
 * (S14X-283's call sites). Run here against a fake curl:
 *   - production as it is today (the chunks cut to their tells on 2026-11-17:
 *     bare locale calls in the pages, six UTF-8 .txt reads, no refusal key)
 *     prints INFO for every claim and no FAIL;
 *   - a good deploy prints PASS for every claim, with the owner's English
 *     dashboards still formatting bare and a bare Intl formatter used only
 *     for its time zone;
 *   - each regression prints FAIL: every spelling of the browser's locale in a
 *     reader's chunk, one in a chunk only a lazy import two hops deep names,
 *     each upload box reading a .txt as UTF-8 again, a landing that refuses
 *     the .txt without the decoder, a success page that refuses it in English
 *     again (R1), and a bundle layout the walk cannot read;
 *   - every request is a GET, each chunk is read once, and the key is never
 *     printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-call-sites-b.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bcs";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time","-w"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbcs-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
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

const times = (s: string, n: number) => Array.from({ length: n }, () => s).join(";");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Chunks = Record<string, string>;

// Production on 2026-11-17, each chunk cut to its tells (Index-B_0ILwfg.js,
// Jobs-DGFoTN43.js, ProductSuccess-CM78qtVJ.js, Shortlist-C5tqaT0f.js,
// Success-BjD-tPKn.js, AgentStatusBand-LkUw1gBT.js, HealthCheck-BN4OaE8U.js,
// DataViz-DhtZsoxV.js): the five boxes and the agent band read a .txt with
// the File's own text(), and the pages format bare.
const OLD: Chunks = {
  "Index-IX.js": `if(c.type==="text/plain"){const D=await c.text();if(!N())return;R(D)}t("homepage.toast.fileDamaged");${times("e.toLocaleString()", 14)}`,
  "Jobs-JB.js": `const Dp=()=>import("./Deep-DP.js");if(s.type==="text/plain"||l.endsWith(".txt"))m=await s.text();${times("n.toLocaleString()", 59)};new Intl.DisplayNames(void 0,{type:"region"})`,
  "Deep-DP.js": "export const d=1;",
  "ProductSuccess-PS.js": `if(i.type==="text/plain"){const c=await i.text();h(c)}${times("new Date(x).toLocaleDateString()", 3)}`,
  "Shortlist-SL.js": 'const r=e.name.split(".").pop().toLowerCase();if(r==="txt"){_(await e.text());return}new Date(a).toLocaleString()',
  "Success-SC.js": `if(n.type==="text/plain"){const P=await n.text();R(P)}${times("t.length.toLocaleString()", 4)}`,
  "AgentStatusBand-AB.js": 'async function Ce(a){try{if(a.type==="text/plain"||/\\.txt$/i.test(a.name))return await a.text();return""}catch{return""}}',
  "HealthCheck-HC.js": times("new Date(x).toLocaleString()", 25),
  "DataViz-DV.js": `new Intl.NumberFormat(void 0,{maximumFractionDigits:1});${times("v.toLocaleString()", 5)}`,
};
// As a build of bugs/b-call-sites writes them (Index-DaYxB206.js,
// resumeText-fzADAZB2.js, Jobs-2-_Lxuc0.js, ProductSuccess-CBb4vMa4.js,
// Success-_KLsXIvJ.js), cut to the same tells.
const READER = 'async function r(e){const t=new Uint8Array(await e.arrayBuffer());let n;if(t[0]===255&&t[1]===254)n=new TextDecoder("utf-16le").decode(t.subarray(2));else if(t[0]===254&&t[1]===255)n=new TextDecoder("utf-16be").decode(t.subarray(2));else n=new TextDecoder("windows-1252").decode(t);return{text:n,garbled:!1}}async function s(e){try{if(e.type==="text/plain"||/\\.txt$/i.test(e.name)){const{text:a,garbled:o}=await r(e);return o?"":a}return""}catch{return""}}export{r,s};';
const LANDING = 'import{r as cn}from"./resumeText-RT.js";if(o.type==="text/plain"){const{text:R,garbled:U}=await cn(o);if(!N())return;if(U){_({title:s("ingestParsers.refusal.txtUnreadable"),description:s("ingestParsers.refusal.txtUnreadableDescription"),variant:"destructive"});return}}t("homepage.toast.fileDamaged");Ct(e)';
/** The success page as this round builds it: the landing's two keys, then the file let go. */
const SUCCESS = 'import{r as Dr}from"./resumeText-RT.js";if(n.type==="text/plain"){const{text:o,garbled:v}=await Dr(n);if(v){m({title:t("ingestParsers.refusal.txtUnreadable"),description:t("ingestParsers.refusal.txtUnreadableDescription"),variant:"destructive"});F(null);return}k(o)}';
/** The success page as part B's call-sites lane built it: the refusal thrown as an English sentence. */
const SUCCESS_ENGLISH = 'import{r as Dr}from"./resumeText-RT.js";if(n.type==="text/plain"){const{text:o,garbled:v}=await Dr(n);if(v)throw new Error("Could not read the file. Please try pasting your resume text instead.");k(o)}';
const NEW: Chunks = {
  "Index-IX.js": LANDING,
  "resumeText-RT.js": READER,
  "Jobs-JB.js": 'import{r as Sf}from"./resumeText-RT.js";const Dp=()=>import("./Deep-DP.js");if(s.type==="text/plain"||l.endsWith(".txt")){const x=await Sf(s);m=x.garbled?"":x.text}Q(n);new Intl.DisplayNames(void 0,{type:"region"});const z=Intl.DateTimeFormat().resolvedOptions().timeZone',
  "Deep-DP.js": "export const d=1;",
  "ProductSuccess-PS.js": SUCCESS,
  "Shortlist-SL.js": 'import{r as gt}from"./resumeText-RT.js";if(r==="txt"){const{text:a,garbled:b}=await gt(e);if(b)return;_(a)}fe(n.sent_at,{lng:"en"})',
  "Success-SC.js": 'import{r as Gt}from"./resumeText-RT.js";if(r.type==="text/plain"){const{text:D,garbled:ee}=await Gt(r);if(ee)throw new Error("unreadable text file");R(D)}',
  "AgentStatusBand-AB.js": 'import{s as Ce}from"./resumeText-RT.js";',
  "HealthCheck-HC.js": times("new Date(x).toLocaleString()", 25),
  "DataViz-DV.js": 'v.toLocaleString("en-US");new Intl.NumberFormat("en-US",{maximumFractionDigits:1})',
};
const FILLERS = Array.from({ length: 110 }, (_, i) => `f${i}-FL.js`);

/** The routes: the homepage and /jobs name the entry, the entry preloads every chunk but the lazy Deep one. */
function site(chunks: Chunks, opts: { fillers?: number; entry?: boolean } = {}): Route[] {
  const fillers = FILLERS.slice(0, opts.fillers ?? FILLERS.length);
  const preload = [...Object.keys(chunks).filter((n) => n !== "Deep-DP.js"), ...fillers];
  const entry = `const m=[${preload.map((n) => `"assets/${n}"`).join(",")}];console.log(m)`;
  const home = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-E1.js"></script><link rel="modulepreload" crossorigin href="/assets/Index-IX.js"></head><body><div id="root"></div></body></html>';
  return [
    { match: "^GET https://site\\.test/$", body: home },
    { match: "^GET https://site\\.test/jobs$", body: home },
    ...(opts.entry === false ? [] : [{ match: "^GET https://site\\.test/assets/index-E1\\.js$", body: entry }]),
    ...Object.entries(chunks).map(([n, body]) => ({ match: `^GET https://site\\.test/assets/${esc(n)}$`, body })),
    { match: "^GET https://site\\.test/assets/f\\d+-FL\\.js$", body: "export const f=1;" },
    { match: "^GET https://site\\.test/assets/", status: 404, body: "<!doctype html><title>Not found</title>" },
  ];
}

const line = (lines: string[], id: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO)  ${id} `).test(l));
const verdict = (lines: string[], id: string) => line(lines, id).map((l) => l.slice(0, 4));
const show = (lines: string[]) => lines.join("\n");

describe("today's production", () => {
  it("prints INFO for every claim and no FAIL: the merge has not published", () => {
    const { lines } = run(site(OLD));
    expect(lines.filter((l) => /^FAIL/.test(l)), show(lines)).toEqual([]);
    expect(lines.filter((l) => /^PASS/.test(l)), show(lines)).toEqual([]);
    for (const id of ["L0", "L1", "R1", "D1", "T1"]) expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["INFO"]);
    expect(line(lines, "L0")[0]).toMatch(/read 120 chunks/);
    // The owner's 25 stay out of the count; the region name is not a figure.
    expect(line(lines, "D1")[0], show(lines)).toMatch(/S14X-255 87 calls in 6 chunks .* hold 25\): not published yet/);
    expect(line(lines, "T1")[0], show(lines)).toMatch(/6 places read a \.txt upload/);
    for (const n of ["AgentStatusBand-AB.js", "Index-IX.js", "Jobs-JB.js", "ProductSuccess-PS.js", "Shortlist-SL.js", "Success-SC.js"]) expect(line(lines, "T1")[0]).toContain(n);
  });
});

describe("a good deploy", () => {
  it("passes every claim, with the owner dashboards still English and a time-zone read left alone", () => {
    const { lines } = run(site(NEW));
    expect(lines.filter((l) => /^FAIL/.test(l)), show(lines)).toEqual([]);
    for (const id of ["L1", "R1", "D1", "T1"]) expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["PASS"]);
    expect(line(lines, "L1")[0]).toContain("Index-IX.js");
    expect(line(lines, "R1")[0]).toContain("ProductSuccess-PS.js");
    expect(line(lines, "L1")[0]).toContain("resumeText-RT.js");
    expect(line(lines, "D1")[0]).toMatch(/none of the 121 chunks .* hold 25\)/);
  });
});

describe("each regression fails once the merge has published", () => {
  it.each([
    ["no locale", "new Date(x).toLocaleDateString()"],
    ["an undefined locale", "n.toLocaleString(void 0,{maximumFractionDigits:1})"],
    ["an empty list", 'new Date(x).toLocaleTimeString([],{hour:"numeric"})'],
    ["an Intl formatter with an undefined locale", 'new Intl.NumberFormat(void 0,{style:"currency",currency:"EUR"}).format(p)'],
    ["an Intl formatter with no locale", "new Intl.PluralRules().select(n)"],
  ])("D1: %s in the board's chunk", (_why, call) => {
    const { lines } = run(site({ ...NEW, "Jobs-JB.js": `${NEW["Jobs-JB.js"]};${call}` }));
    expect(verdict(lines, "D1"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "D1")[0]).toContain("Jobs-JB.js x1");
    expect(verdict(lines, "T1"), show(lines)).toEqual(["PASS"]);
  });

  it("D1: a chunk only a lazy import two hops from the entry names is walked and judged", () => {
    const { lines, calls } = run(site({ ...NEW, "Deep-DP.js": "export const d=x.toLocaleString();" }));
    expect(calls.some((c) => /GET https:\/\/site\.test\/assets\/Deep-DP\.js/.test(c)), "the walk never read the lazy chunk").toBe(true);
    expect(verdict(lines, "D1"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "D1")[0]).toContain("Deep-DP.js x1");
  });

  it.each([
    ["the board", "Jobs-JB.js", 'if(s.type==="text/plain"||l.endsWith(".txt"))m=await s.text();'],
    ["the success page", "ProductSuccess-PS.js", 'if(i.type==="text/plain"){const c=await i.text();h(c)}'],
    ["Shortlist", "Shortlist-SL.js", 'if(r==="txt"){_(await e.text());return}'],
    ["the recovery panel", "Success-SC.js", 'if(n.type==="text/plain"){const P=await n.text();R(P)}'],
    ["the agent band", "AgentStatusBand-AB.js", 'async function Ce(a){if(a.type==="text/plain"||/\\.txt$/i.test(a.name))return await a.text()}'],
  ])("T1: %s reads a .txt as UTF-8 again", (_box, chunk, code) => {
    const { lines } = run(site({ ...NEW, [chunk]: code }));
    expect(verdict(lines, "T1"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "T1")[0]).toContain(chunk);
    expect(verdict(lines, "D1"), show(lines)).toEqual(["PASS"]);
  });

  it("R1: a success page that refuses an unreadable .txt in English again fails, and the landing still passes", () => {
    const { lines } = run(site({ ...NEW, "ProductSuccess-PS.js": SUCCESS_ENGLISH }));
    expect(verdict(lines, "R1"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "R1")[0]).toMatch(/ProductSuccess-PS\.js carries no ingestParsers\.refusal\.txtUnreadable/);
    expect(verdict(lines, "L1"), show(lines)).toEqual(["PASS"]);
    expect(verdict(lines, "T1"), show(lines)).toEqual(["PASS"]);
  });

  it("L1: a landing that refuses a .txt it read without the decoder fails", () => {
    const blind = LANDING.replace('import{r as cn}from"./resumeText-RT.js";', 'const cn=async(f)=>({text:new TextDecoder().decode(await f.arrayBuffer()),garbled:!1});');
    const { lines } = run(site({ ...NEW, "Index-IX.js": blind, "resumeText-RT.js": "export const r=1;" }));
    expect(verdict(lines, "L1"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "L1")[0]).toContain("Index-IX.js");
  });
});

describe("a layout the walk cannot read fails L0 and judges nothing", () => {
  it.each([
    ["an entry the server does not hold", site(NEW, { entry: false }), /could not be read/],
    ["fewer than 100 chunks", site(NEW, { fillers: 20 }), /read 31 chunks .*want at least 100/],
    ["no Shortlist page chunk", site(Object.fromEntries(Object.entries(NEW).filter(([n]) => n !== "Shortlist-SL.js"))), /no page chunk for Shortlist/],
  ])("%s", (_why, routes, said) => {
    const { lines } = run(routes);
    expect(verdict(lines, "L0"), show(lines)).toEqual(["FAIL"]);
    expect(line(lines, "L0")[0]).toMatch(said);
    for (const id of ["L1", "R1", "D1", "T1"]) expect(line(lines, id), `${id} was judged without its chunks`).toEqual([]);
  });
});

describe("the section only reads", () => {
  it("every request is a GET, each chunk is fetched once, and the key is never sent or printed", () => {
    const { calls, out } = run(site(NEW));
    expect(calls.length).toBeGreaterThan(120);
    expect(calls.filter((c) => !/^curl\tGET https:\/\/site\.test\//.test(c)), "a request that is not a GET of the site").toEqual([]);
    const urls = calls.map((c) => c.split("\t")[1]);
    expect(urls.length - new Set(urls).size, "a chunk fetched twice").toBe(0);
    expect(calls.join("\n")).not.toContain(KEY);
    expect(out).not.toContain(KEY);
  });
});
