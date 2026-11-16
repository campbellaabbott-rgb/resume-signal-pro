// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-account CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-account.sh judges the account lane
 * of the 2026-11-08 bug round: two function builds, twelve marks in the
 * published Account chunk and the agent panels chunk, the dates the browser
 * still formats, and the account translation shard. Run here against a fake
 * curl:
 *   - production as it is today (both functions at 2026-11-09.1, the Account
 *     chunk with 18 bare locale calls, no account shard) prints no FAIL;
 *   - the functions live with the old page, and the page published with the
 *     old functions, print no FAIL either: either may land first;
 *   - a good deploy prints PASS for every claim;
 *   - each regression prints FAIL: a missing build header, one function left
 *     behind by the paste, each mark missing once any mark is published, a
 *     date left to the browser, a shard missing or short of a string, and a
 *     bundle layout the section cannot read;
 *   - every request is a GET or an OPTIONS, and the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-account.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bac";
const P = "https://p\\.supabase\\.co";
const S = "https://site\\.test";

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
  const dir = mkdtempSync(join(tmpdir(), "vdbac-"));
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

// The Account chunk and the agent panels chunk as production serves them on
// 2026-11-15 (Account-g0tNFsUF.js, AgentStatusBand-DUFZlEFk.js), cut to their
// tells: 16 + 2 bare locale calls, 1 + 2 in the panels ...
const OLD_ACC = [
  'import{s as e}from"./index-A1.js";e.functions.invoke("get-account-data",{});',
  'const k=`rb_last_resume_decided:${u}`;localStorage.setItem("rb_scan_fixes",JSON.stringify({rewrites:[],keywords:t.map(([l])=>l),reportId:null}));',
  times("new Date(x).toLocaleDateString()", 16), times("n.toLocaleString()", 2),
].join("");
const OLD_PANELS = 'const a=t("applyProfile.title","Profile");const b=t("applyQueue.sUncertain");new Date(x).toLocaleDateString();n.toLocaleString();m.toLocaleString();';
// ... and as this branch builds them (the tells read from a build of it).
const NEW_ACC = [
  'import{s as e}from"./index-A1.js";import{A as b}from"./AgentStatusBand-PB.js";e.functions.invoke("get-account-data",{body:{action:"export"}}).then(r=>r.data.serverRecords);',
  't("accountView.trackerLoadFailed","We could not load");t("accountView.lifecycleNotChecked");t("accountView.fitCheckHourly");',
  'const p=typeof r?.portalLoginUrl=="string"?r.portalLoginUrl:"";',
  'if(ge&&!(f.median.ok&&f.neverHalf.ok)||!ge&&(f.ceilingBasis!=="fills"||typeof f.ceiling14!="number"))return null;',
  'const k=`rb_last_resume_decided_by_text:${u}:${h}`;t("accountView.passRetired",{support:s});const st=new Set(["open_to_run"]);',
  'localStorage.setItem("rb_scan_fixes",JSON.stringify({rewrites:[],keywords:t.map(([m])=>m),reportId:null,fingerprint:a?bn(a):null}));',
  times("new Date(x).toLocaleDateString()", 2), "c.n.toLocaleString()",
].join("");
const LNGS = ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"];
const SHARD_KEYS = ["followUpDraft", "followUpWhen", "postingOpen", "ivOutcomeQ", "ivhClosedAfter", "ivhSinceTitle", "trackerLoadFailed", "queueRetired", "agentProfileRetired"];
// The English account strings, as the namespace plugin registers them (the
// bug round's review moved them out of the entry): a build of this branch put
// them in the chunk the Account and Agent pages share.
const EN_STRINGS = (drop: string[] = []) => `ne({accountView:{${SHARD_KEYS.filter((k) => !drop.includes(k)).map((k) => `${k}:"en ${k}"`).join(",")}}});`;
const NEW_PANELS = `const a=t("applyProfile.title","Profile");t("accountView.queueRetired");t("accountView.agentProfileRetired");t("accountView.queueUncertain");${EN_STRINGS()}`;
const SHARD = (lng: string, drop: string[] = []) => `const e={${SHARD_KEYS.filter((k) => !drop.includes(k)).map((k) => `${k}:"${lng} ${k}"`).join(",")}};export{e as default};`;
const OTHER_SHARDS = 'const r={"./shards/company/de.json":()=>O(()=>import("./de-Co1.js"),[]),"./shards/company/en.json":jN};';
const OLD_ENTRY = `const m=["assets/Account-AC.js","assets/Agent-AG.js"];${OTHER_SHARDS}`;
/** The entry: the eight lazy shards, and (`en`, a build from before the review) the English strings beside them. */
const NEW_ENTRY = (lngs: string[] = LNGS, en = false) =>
  `const m=["assets/Account-AC.js","assets/Agent-AG.js"];${OTHER_SHARDS}${en ? `const kN={${SHARD_KEYS.map((k) => `${k}:"en ${k}"`).join(",")}};` : ""}const q={${en ? '"./shards/account/en.json":kN,' : ""}${lngs.map((l) => `"./shards/account/${l}.json":()=>O(()=>import("./${l}-Sh${l.replace("-", "")}.js"),[])`).join(",")}};`;
const AGENT = 'import{A as s}from"./AgentStatusBand-PB.js";import{F as f}from"./Footer-F1.js";import"./index-A1.js";const R=y.lazy(()=>import("./AgentReachNote-RN.js"));';

type Over = Partial<{
  gad: string | null; ord: string | null;
  home: string; entry: string; acc: string; agent: string; panels: string;
  shard: Record<string, string>;
}>;

function routes(o: Over = {}, fns = true, fe = true): Route[] {
  const gad = o.gad === undefined ? (fns ? "get-account-data.2026-11-12.1" : "get-account-data.2026-11-09.1") : o.gad;
  const ord = o.ord === undefined ? (fns ? "account-order.2026-11-12.1" : "account-order.2026-11-09.1") : o.ord;
  return [
    { match: `^OPTIONS ${P}/functions/v1/get-account-data$`, headers: gad ? { "x-fn-build": gad } : {} },
    { match: `^OPTIONS ${P}/functions/v1/account-order$`, headers: ord ? { "x-fn-build": ord } : {} },
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: o.entry ?? (fe ? NEW_ENTRY() : OLD_ENTRY) },
    { match: `^GET ${S}/assets/Account-AC\\.js$`, body: o.acc ?? (fe ? NEW_ACC : OLD_ACC) },
    { match: `^GET ${S}/assets/Agent-AG\\.js$`, body: o.agent ?? AGENT },
    { match: `^GET ${S}/assets/AgentStatusBand-PB\\.js$`, body: o.panels ?? (fe ? NEW_PANELS : OLD_PANELS) },
    { match: `^GET ${S}/assets/Footer-F1\\.js$`, body: 'export const F=()=>null;' },
    { match: `^GET ${S}/assets/AgentReachNote-RN\\.js$`, body: 'export default ()=>null;' },
    ...LNGS.map((l) => ({ match: `^GET ${S}/assets/${l}-Sh${l.replace("-", "")}\\.js$`, body: o.shard?.[l] ?? SHARD(l) })),
  ];
}

const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const MARKS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "Q1", "Q2"];
const CLAIMS = ["F1", "F2", ...MARKS, "D1", "S1"];
const claim = (verdict: string, c: string) => new RegExp(`^${verdict} {2}${c} `);

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false, false));
  it("prints no FAIL: every claim not yet shipped is INFO", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}D1 .*prints 18 and the agent panels chunk 3 /), show(lines)).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz-bugs-account\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("either half may land first", () => {
  it("the functions live with the old page: the builds pass, the page waits, nothing fails", () => {
    const { lines } = run(routes({}, true, false));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", claim("PASS", "F1")) && has(lines, "PASS", claim("PASS", "F2")), show(lines)).toBe(true);
    for (const c of [...MARKS, "D1", "S1"]) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("the page published with the old functions: the marks pass, the builds wait, nothing fails", () => {
    const { lines } = run(routes({}, false, true));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of [...MARKS, "D1", "S1"]) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", claim("INFO", "F1")) && has(lines, "INFO", claim("INFO", "F2")), show(lines)).toBe(true);
  });
});

describe("a good deploy", () => {
  const { lines, calls } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("a later build of either function still passes", () => {
    const later = run(routes({ gad: "get-account-data.2026-11-20.1", ord: "account-order.2026-11-12.3" })).lines;
    expect(fails(later), show(later)).toEqual([]);
    expect(has(later, "PASS", claim("PASS", "F1")) && has(later, "PASS", claim("PASS", "F2")), show(later)).toBe(true);
  });
  it("the fill-basis comparison passes in either order the minifier writes it", () => {
    const flipped = run(routes({ acc: NEW_ACC.replace('f.ceilingBasis!=="fills"', '"fills"!==f.ceilingBasis') })).lines;
    expect(has(flipped, "PASS", claim("PASS", "A5")), show(flipped)).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted", () => {
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
  });
});

describe("each regression prints FAIL", () => {
  it("F1, F2: no build header; one function left behind by the paste, either way round", () => {
    expect(has(run(routes({ gad: null })).lines, "FAIL", /^FAIL {2}F1 get-account-data preflight carries no x-fn-build/)).toBe(true);
    expect(has(run(routes({ ord: "account-order.2026-11-09.1" })).lines, "FAIL", /^FAIL {2}F2 account-order .*older than 2026-11-12\.1, though get-account-data/)).toBe(true);
    expect(has(run(routes({ gad: "get-account-data.2026-11-09.1" })).lines, "FAIL", /^FAIL {2}F1 get-account-data .*older than 2026-11-12\.1, though account-order/)).toBe(true);
  });

  // Each mark's tell, as the published chunk spells it; removing it alone must fail that claim alone.
  const TELLS: Record<string, [keyof Over, string]> = {
    A1: ["acc", "accountView.trackerLoadFailed"],
    A2: ["acc", "accountView.lifecycleNotChecked"],
    A3: ["acc", "accountView.fitCheckHourly"],
    A4: ["acc", "portalLoginUrl"],
    A5: ["acc", 'f.ceilingBasis!=="fills"'],
    A6: ["acc", "rb_last_resume_decided_by_text:"],
    A7: ["acc", "accountView.passRetired"],
    A8: ["acc", "open_to_run"],
    A9: ["acc", "serverRecords"],
    A10: ["acc", ",fingerprint:"],
    Q1: ["panels", "accountView.queueRetired"],
    Q2: ["panels", "accountView.agentProfileRetired"],
  };
  it.each(MARKS)("%s: its tell missing once the rest are published", (c) => {
    const [file, tell] = TELLS[c];
    const base = file === "acc" ? NEW_ACC : NEW_PANELS;
    expect(base).toContain(tell);
    const { lines } = run(routes({ [file]: base.split(tell).join("x") }));
    expect(has(lines, "FAIL", claim("FAIL", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", c).test(l)), show(lines)).toEqual([]);
  });

  it("D1: a fourth bare call in the Account chunk, or one in the agent panels chunk", () => {
    const acc = run(routes({ acc: `${NEW_ACC};new Date(y).toLocaleDateString()` })).lines;
    expect(has(acc, "FAIL", /^FAIL {2}D1 .*still prints 4 and the agent panels chunk 0 /), show(acc)).toBe(true);
    const pan = run(routes({ panels: `${NEW_PANELS};d.toLocaleTimeString()` })).lines;
    expect(has(pan, "FAIL", /^FAIL {2}D1 .*still prints 3 and the agent panels chunk 1 /), show(pan)).toBe(true);
  });

  it("S1: seven shards, a shard short of a string, no English strings anywhere or one short, no shard at all once published", () => {
    expect(has(run(routes({ entry: NEW_ENTRY(LNGS.slice(1)) })).lines, "FAIL", /^FAIL {2}S1 .*names 7 non-English account shards, not 8/)).toBe(true);
    const short = run(routes({ shard: { fr: SHARD("fr", ["followUpWhen"]) } })).lines;
    expect(has(short, "FAIL", /^FAIL {2}S1 .*missing: fr:followUpWhen$/), show(short)).toBe(true);
    const noEn = run(routes({ panels: NEW_PANELS.replace(EN_STRINGS(), "") })).lines;
    expect(has(noEn, "FAIL", /^FAIL {2}S1 .*neither the Account chunk \(Account-AC\.js\), a chunk it imports nor the entry carries the English strings: en:followUpDraft en:followUpWhen/), show(noEn)).toBe(true);
    const enShort = run(routes({ panels: NEW_PANELS.replace(EN_STRINGS(), EN_STRINGS(["ivhSinceTitle"])) })).lines;
    expect(has(enShort, "FAIL", /^FAIL {2}S1 .*the English strings: en:ivhSinceTitle$/), show(enShort)).toBe(true);
    expect(has(run(routes({ entry: OLD_ENTRY })).lines, "FAIL", /^FAIL {2}S1 .*published but the entry loads no account shard/)).toBe(true);
  });

  it("S1: the English strings ride with the page, or in the entry as a build from before the review carried them", () => {
    const withPage = run(routes()).lines;
    expect(has(withPage, "PASS", /^PASS {2}S1 S14X-254 the English account strings ride with the page \(Account-AC\.js or a chunk it imports\) and the entry names 8 more languages/), show(withPage)).toBe(true);
    const inEntry = run(routes({ entry: NEW_ENTRY(LNGS, true), panels: NEW_PANELS.replace(EN_STRINGS(), "") })).lines;
    expect(has(inEntry, "PASS", claim("PASS", "S1")), show(inEntry)).toBe(true);
    expect(fails(inEntry), show(inEntry)).toEqual([]);
  });

  it("a layout the section cannot read: no entry, no Account chunk calling get-account-data, no panels chunk", () => {
    expect(has(run(routes({ home: "<html></html>" })).lines, "FAIL", /^FAIL {2}A1 the homepage names no/)).toBe(true);
    expect(has(run(routes({ acc: NEW_ACC.split("get-account-data").join("x") })).lines, "FAIL", /^FAIL {2}A1 .*names no Account chunk that calls get-account-data/)).toBe(true);
    expect(has(run(routes({ panels: NEW_PANELS.split("applyProfile.title").join("x") })).lines, "FAIL", /^FAIL {2}Q1 no chunk the Agent page .*imports carries applyProfile\.title/)).toBe(true);
  });
});
