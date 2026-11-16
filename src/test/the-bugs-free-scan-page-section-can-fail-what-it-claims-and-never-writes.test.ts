// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-free-scan-page CAN FAIL WHAT IT CLAIMS, NEVER
 * FAILS ON TODAY'S PRODUCTION, WAITS FOR THE OWNER, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-page.sh judges the
 * free-scan-page lane of the 2026-11-08 bug round from the chunks
 * /resume-checker loads, and the owner's S14X-012 and S14X-101 halves from
 * the report chunk and two function builds. Run here against a fake curl and
 * a ledger of the test's own:
 *   - production as it is today (the chunks cut to their tells: no
 *     freeScanPage key, the old literals, save-lead 2026-11-09.1) prints no
 *     FAIL, every claim says 'not yet published' and the owner lines say
 *     'owner pending';
 *   - the lane's build, with both owner answers and the round's function
 *     builds, prints PASS for every claim;
 *   - each regression prints FAIL for its own claim, and a layout the section
 *     cannot read is a FAIL, not a quiet pass;
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
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-free-scan-page.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bfsp";
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

function run(routes: Route[], ownerDecided: Record<string, unknown> = {}): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdbfsp-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "ledger.json"), JSON.stringify({ reservations: { "bug-round": { ownerDecided } } }));
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"), VDFS_LEDGER: join(dir, "ledger.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

// The chunks as production serves them today (2026-11-15: index-psPxJH_H.js,
// Index-DQceY4JE.js, FreeKeywordResults-B8sPxjwJ.js, ATSParseSimulator-CPPT-WtG.js,
// CvStandards-CRx5SnQW.js), cut to their tells ...
const PAGE = '<html><head><script type="module" crossorigin src="/assets/index-E1.js"></script><link rel="modulepreload" crossorigin href="/assets/Index-A1.js"></head></html>';
const market = (n: number) => "[" + Array.from({ length: n }, (_, i) => `["${String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26))}","Market ${i}"]`).join(",") + "]";
const OLD_ENTRY = 'const r=[()=>import("./CvStandards-C1.js")];const tl={sub:"Tienes 7 escaneos gratis al día",verify:"Every quoted line is verified against your resume"};function c2(t,e){const n=new URLSearchParams(t);return e==="#upload"?`/resume-checker${t}`:null}';
const OLD_IDX = 'import{a as e}from"./index-E1.js";const F=()=>import("./FreeKeywordResults-F1.js");function startStreamingScan(e,t,n){return fetch(u,{method:"POST",body:JSON.stringify({resumeText:e,jobDescription:t}),signal:n})}'
  + 'const M=' + market(24) + ';'
  + 'e.jsxs(fe,{size:"xl",onClick:Ns,className:"w-full sm:w-auto sm:min-w-[340px] h-16 text-lg gap-3 border-2 border-success bg-success hover:bg-success/90"});'
  + 'e.jsx(fe,{variant:"hero",size:"xl",className:"w-full sm:w-auto sm:min-w-[340px] h-16 text-lg gap-3 shadow-xl"});'
  + 'c({title:"Unsupported file type",variant:"destructive"});c({title:"Scan credit used"});'
  + 'const T=await w("generate-tailored-resume",{resumeText:f},{maxRetries:2,timeout:155e3});if(T.error)c({title:"Failed to generate tailored resume"});'
  + 'if(s.code==="rate_limited_budget")q();e.jsx("input",{type:"file",accept:".pdf,.docx,.doc,.txt"});const hint="Scan up to 7 scans a day";';
const OLD_FKR = 'import{s as e}from"./Index-A1.js";const P=()=>import("./ATSParseSimulator-S1.js");'
  + 'const L={enhancedAnalysis:{atsCompat:"ATS Compatibility",credibilityFlags:"Credibility Flags",highPriority:"High Priority"}};'
  + 'e.jsx("h4",{children:"ATS Compatibility"});e.jsx("h4",{children:"Recruiter Impact"});e.jsx("h4",{children:"Credibility Flags"});e.jsx("span",{children:"High Priority"});'
  + 'e.jsx("h4",{children:"Content Insights"});e.jsx("p",{children:"Quantified Metrics Found"});e.jsx("h4",{children:"Executive Scope Check"});e.jsx("h4",{children:"Section Length Audit"});'
  + 'e.jsx("h4",{children:"ATS Parse Preview"});e.jsxs("p",{children:["Target ATS: ",e.jsx("b",{})]});const za={critical:{label:"Must have"},high:{label:"High impact"}};'
  + 'e.jsxs("h3",{children:[je.countryName," Market Intelligence"]});e.jsxs("h4",{children:["📋 ",je.countryName," CV norms"]});e.jsx("span",{children:"Triggered by:"});'
  + 'const ring={background:`conic-gradient(#16a34a ${a*3.6}deg, #e5e7eb 0deg)`};e.jsxs("h2",{children:[z,"\'s Results"]});'
  + 'if(r.includes("ea"))x="Executive Assistant";const sub=`${ind.replace(/_/g," ")} (${c} confidence)`;const n=d.atsNote;t("freeResults.confidencePercent",{confidence:r.confidence});'
  + 'localStorage.setItem("rb_scan_fixes",JSON.stringify({fixes:a}));const f="Every quoted line in the full report is verified";line(`ATS Score: ${s}/100  →  about ${p} after fixes`);'
  + 'Ue.functions.invoke("save-lead",{body:{email:m}});Ue.functions.invoke("send-scan-report",{body:{email:U,dripOptIn:C}});t("freeResults.enterprise.dripConfirmSent");';
const OLD_APS = 'const claim="The actual text an ATS extracted from your upload. Not a simulation.";';
const OLD_CVS = 'e.jsx(u,{to:o==="es"?"/es/revisar-curriculum":"/resume-checker",children:[i.ctaButton]});';

// ... and as this branch builds them.
const NEW_ENTRY = 'const r=[()=>import("./CvStandards-C1.js")];const en={freeScanPage:{keywordImpact:{mustHave:"Must have"},report:{triggeredBy:"Triggered by:"},checkout:{postingOverCap:"The analysis reads the first 20,000 characters."}}};'
  + 'function c2(t,e){const n=new URLSearchParams(t);return e==="#pricing"&&n.get("utm_medium")==="scan_report"?`/pricing${t}#full-analysis`:e==="#upload"?`/resume-checker${t}`:null}';
const NEW_IDX = 'import{a as e}from"./index-E1.js";const F=()=>import("./FreeKeywordResults-F1.js");function startStreamingScan(e,t,n){return fetch(u,{method:"POST",body:JSON.stringify({resumeText:e,jobDescription:t,userContext:o.userContext,deadlineAt:o.deadlineAt}),signal:n})}'
  + 'const M=' + market(52) + ';'
  + 'sessionStorage.setItem("rb_pending_report",JSON.stringify(p));'
  + 'e.jsxs(fe,{size:"xl",onClick:Ns,className:"w-full sm:w-auto sm:min-w-[340px] h-auto min-h-16 py-3 px-4 sm:px-8 text-base sm:text-lg text-center justify-center gap-3 border-2 border-success bg-success"});'
  + 'e.jsx(fe,{variant:"hero",size:"xl",className:"w-full sm:w-auto sm:min-w-[340px] h-16 text-lg gap-3 shadow-xl"});'
  + 'c({title:t("homepage.toast.unsupportedFileType"),variant:"destructive"});c({title:t("freeScanPage.toast.creditUsedTitle")});t("freeScanPage.hero.dropzone");'
  + 'const T=await w("generate-tailored-resume",{resumeText:f},{maxRetries:2,shouldRetry:Ps,enableCircuitBreaker:!1,timeout:155e3});'
  + 'if(s.code==="rate_limited_budget")c({title:t("freeScanPage.toast.budgetTitle")});e.jsx("input",{type:"file",accept:".pdf,.docx,.txt"});'
  + 't("freeScanPage.checkout.postingOverCap");t("freeScanPage.jobUrl.truncated");t("freeScanPage.intent.heading");t(`freeScanPage.parse.issue.${k}`);';
const NEW_FKR_BASE = 'import{s as e}from"./Index-A1.js";const P=()=>import("./ATSParseSimulator-S1.js");'
  // A namespace's English values ride here as an object: never a printed literal.
  + 'const L={enhancedAnalysis:{atsCompat:"ATS Compatibility",credibilityFlags:"Credibility Flags",highPriority:"High Priority",metricsFound:"Quantified Metrics Found"}};'
  + 'e.jsx("h4",{children:t("enhancedAnalysis.atsCompat")});e.jsxs("h3",{children:[t("freeScanPage.market.title",{country:je.countryName})]});'
  + 'const sub=`${y(ind)} (${t("freeResults.confidencePercent",{confidence:t(`freeScanPage.confidence.${c}`)})})`;'
  + 'e.jsx("circle",{"data-score-arc":"",strokeDasharray:`${a} ${Y}`});const h=n?t("shareableCard.results",{name:n}):t("freeScanPage.share.yourResults");'
  + 'e.jsx("p",{children:t("freeScanPage.pulse.notAsked")});const pg=cs==null?void 0:cs.pagesMin;'
  + 'localStorage.setItem("rb_scan_fixes",JSON.stringify({fixes:a,fingerprint:fp}));e.jsx("div",{"data-summary-print":""});add(t("freeScanPage.pdf.projected",{score:p}));';
// Before the owner's answers: the tips box and the drip box are still there.
const NEW_FKR = NEW_FKR_BASE + 'Ue.functions.invoke("save-lead",{body:{email:m}});Ue.functions.invoke("send-scan-report",{body:{email:U,dripOptIn:C}});t("freeResults.enterprise.dripConfirmSent");';
// With option B and 'remove' built (bugs/a-free-scan-page-owner).
const NEW_FKR_OWNER = NEW_FKR_BASE + 'Ue.functions.invoke("send-scan-report",{body:{email:U}});';
const NEW_APS = 'const label=t("freeScanPage.parseCheck.label.sections");';
const NEW_CVS = 'e.jsx(u,{to:`${o==="es"?"/es/revisar-curriculum":"/resume-checker"}?market=${n}`,children:[i.ctaButton]});';

type Chunks = { page: string; entry: string; idx: string; fkr: string; aps: string; cvs: string };
const TODAY: Chunks = { page: PAGE, entry: OLD_ENTRY, idx: OLD_IDX, fkr: OLD_FKR, aps: OLD_APS, cvs: OLD_CVS };
const BUILT: Chunks = { page: PAGE, entry: NEW_ENTRY, idx: NEW_IDX, fkr: NEW_FKR, aps: NEW_APS, cvs: NEW_CVS };

function routes(c: Chunks, builds: { saveLead?: string | null; notifyOwner?: string | null } = {}): Route[] {
  const sl = builds.saveLead === undefined ? "save-lead.2026-11-09.1" : builds.saveLead;
  const no = builds.notifyOwner === undefined ? "notify-owner.2026-11-03.1" : builds.notifyOwner;
  return [
    { match: `^GET ${S}/resume-checker$`, body: c.page },
    { match: `^GET ${S}/assets/index-E1\\.js$`, body: c.entry },
    { match: `^GET ${S}/assets/Index-A1\\.js$`, body: c.idx },
    { match: `^GET ${S}/assets/FreeKeywordResults-F1\\.js$`, body: c.fkr },
    { match: `^GET ${S}/assets/ATSParseSimulator-S1\\.js$`, body: c.aps },
    { match: `^GET ${S}/assets/CvStandards-C1\\.js$`, body: c.cvs },
    { match: `^OPTIONS ${P}/functions/v1/save-lead$`, headers: sl ? { "x-fn-build": sl } : {} },
    { match: `^OPTIONS ${P}/functions/v1/notify-owner$`, headers: no ? { "x-fn-build": no } : {} },
  ];
}
const ROUND = { saveLead: "save-lead.2026-11-12.1", notifyOwner: "notify-owner.2026-11-12.1" };
const OWNERS = { "S14X-012": "B", "S14X-101": "remove" };

const CLAIMS = [
  "S14X-019", "S14X-020", "S14X-032", "S14X-057", "S14X-058", "S14X-182", "S14X-210", "S14X-240", "S14X-257",
  "RC-OI-28", "RC-S13-036", "RC-OI-29", "RC-S13-019", "RC-S13-094", "RC-S13-099", "S14X-048", "S14X-253",
  "S14X-285", "S14X-118", "S14X-144", "S14X-269", "S14X-270", "S14X-028", "NB-7", "NB-17",
];
const line = (lines: string[], id: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${id.replace(/[-.]/g, "\\$&")} `).test(l));
const verdict = (lines: string[], id: string) => line(lines, id).map((l) => l.slice(0, 4));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));

describe("today's production", () => {
  const { lines, calls, out } = run(routes(TODAY));

  it("prints no FAIL: every claim is 'not yet published' and every owner line 'owner pending'", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L1"), show(lines)).toEqual(["INFO"]);
    for (const id of CLAIMS) {
      expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["INFO"]);
      expect(line(lines, id)[0]).toMatch(/not yet published/);
    }
    for (const id of ["O1", "O2", "O3"]) expect(line(lines, id)[0], show(lines)).toMatch(/^INFO .*owner pending/);
    expect(line(lines, "O3")[0]).toContain("save-lead.2026-11-09.1");
  });

  it("sends only GETs and OPTIONS, and never prints the key", () => {
    expect(calls.length).toBeGreaterThan(6);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    expect(out).not.toContain(KEY);
  });
});

describe("the lane's build", () => {
  it("passes every claim with both owner answers and the round's function builds", () => {
    const { lines, calls, out } = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }, ROUND), OWNERS);
    expect(fails(lines), show(lines)).toEqual([]);
    expect(verdict(lines, "L1"), show(lines)).toEqual(["PASS"]);
    for (const id of [...CLAIMS, "O1", "O2", "O3"]) expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["PASS"]);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
    expect(out).not.toContain(KEY);
  });

  it("before the owner answers, the published lane passes and the owner lines wait", () => {
    const { lines } = run(routes(BUILT));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const id of CLAIMS) expect(verdict(lines, id), `${id}\n${show(lines)}`).toEqual(["PASS"]);
    for (const id of ["O1", "O2", "O3"]) expect(line(lines, id)[0], show(lines)).toMatch(/^INFO .*owner pending/);
  });

  it("an owner answer before the merge publishes is INFO, not a FAIL", () => {
    const { lines } = run(routes(TODAY), OWNERS);
    expect(fails(lines), show(lines)).toEqual([]);
    expect(line(lines, "O1")[0]).toMatch(/^INFO .*not yet published/);
    expect(line(lines, "O2")[0]).toMatch(/^INFO .*not yet published/);
    expect(line(lines, "O3")[0]).toMatch(/^INFO .*has not landed/);
  });
});

describe("each regression fails its own claim", () => {
  const sub = (s: string, from: string | RegExp, to: string) => {
    const next = s.replace(from, to);
    if (next === s) throw new Error(`the stub carries no ${String(from)}`);
    return next;
  };
  const cases: Array<[string, Partial<Chunks>]> = [
    ["S14X-019", { idx: sub(NEW_IDX, "rb_pending_report", "rb_resume_for_fit") }],
    ["S14X-020", { idx: sub(NEW_IDX, "h-auto min-h-16 py-3 px-4 sm:px-8 text-base sm:text-lg text-center justify-center gap-3 border-2", "h-16 text-lg gap-3 border-2") }],
    ["S14X-032", { idx: sub(NEW_IDX, market(52), market(24)) }],
    ["S14X-032", { cvs: OLD_CVS }],
    ["S14X-057", { fkr: NEW_FKR + 'e.jsx("h4",{children:"Section Length Audit"});' }],
    ["S14X-057", { fkr: NEW_FKR + 'e.jsxs("h3",{children:[je.countryName," Market Intelligence"]});' }],
    ["S14X-057", { fkr: NEW_FKR + 'const za={critical:{label:"Must have"}};' }],
    ["S14X-057", { fkr: sub(NEW_FKR, "freeScanPage.market.title", "freeResults.market.title") }],
    ["S14X-057", { aps: sub(NEW_APS, 't("freeScanPage.parseCheck.label.sections")', '"Section headings"') }],
    ["S14X-057", { fkr: NEW_FKR + 't("freeResults.confidencePercent",{confidence:r.confidence});' }],
    ["S14X-058", { idx: sub(NEW_IDX, "shouldRetry:Ps,enableCircuitBreaker:!1,", "") }],
    ["S14X-058", { idx: NEW_IDX + 'c({title:"Failed to generate tailored resume"});' }],
    ["S14X-182", { idx: sub(NEW_IDX, "freeScanPage.toast.budgetTitle", "homepage.toast.dailyScanLimitReached") }],
    ["S14X-210", { fkr: NEW_FKR + "const ring={background:`conic-gradient(#16a34a ${a}deg, #eee 0deg)`};" }],
    ["S14X-210", { fkr: sub(NEW_FKR, '"data-score-arc":"",', "") }],
    ["S14X-210", { fkr: NEW_FKR + 'e.jsxs("h2",{children:[z,"\'s Results"]});' }],
    ["S14X-240", { fkr: sub(NEW_FKR, "freeScanPage.pulse.notAsked", "freeResults.pulse.sent") }],
    ["S14X-257", { idx: sub(NEW_IDX, 'accept:".pdf,.docx,.txt"', 'accept:".pdf,.docx,.doc,.txt"') }],
    ["RC-OI-28", { fkr: NEW_FKR + 'if(r.includes("ea"))x=1;' }],
    ["RC-S13-036", { aps: NEW_APS + 'const c="Not a simulation.";' }],
    ["RC-OI-29", { fkr: NEW_FKR + "const s2=`${i} (${c} confidence)`;" }],
    ["RC-S13-019", { fkr: NEW_FKR + "const n=d.atsNote;" }],
    ["RC-S13-094", { entry: NEW_ENTRY + 'const s="7 free scans a day";' }],
    ["RC-S13-094", { idx: NEW_IDX + 'const s="Tienes 7 escaneos gratis";' }],
    ["RC-S13-099", { entry: sub(NEW_ENTRY, 'e==="#pricing"&&n.get("utm_medium")==="scan_report"?`/pricing${t}#full-analysis`:', "") }],
    ["S14X-048", { idx: sub(NEW_IDX, 't("freeScanPage.checkout.postingOverCap");', "") }],
    ["S14X-253", { idx: NEW_IDX + 'c({title:"Scan credit used"});' }],
    ["S14X-253", { idx: sub(NEW_IDX, 't("freeScanPage.hero.dropzone");', "") }],
    ["S14X-285", { fkr: sub(NEW_FKR, "JSON.stringify({fixes:a,fingerprint:fp})", "JSON.stringify({fixes:a})") }],
    ["S14X-118", { idx: sub(NEW_IDX, "userContext:o.userContext,", "") }],
    ["S14X-144", { idx: sub(NEW_IDX, ",deadlineAt:o.deadlineAt", "") }],
    ["S14X-269", { fkr: NEW_FKR + 'const f="Every quoted line in the full report is verified";' }],
    ["S14X-269", { entry: NEW_ENTRY + 'const g="Every quoted line is verified";' }],
    ["S14X-270", { idx: sub(NEW_IDX, 't("freeScanPage.jobUrl.truncated");', "") }],
    ["S14X-028", { fkr: sub(NEW_FKR, "const pg=cs==null?void 0:cs.pagesMin;", "") }],
    ["NB-7", { fkr: NEW_FKR + "line(`ATS Score: ${s}/100  →  about ${p} after fixes`);" }],
    ["NB-7", { fkr: sub(NEW_FKR, 'e.jsx("div",{"data-summary-print":""});', "") }],
    ["NB-17", { idx: sub(NEW_IDX, 't("freeScanPage.intent.heading");', "") }],
  ];
  for (const [id, change] of cases) {
    it(`${id}: ${Object.keys(change).join(", ")} regressed`, () => {
      const { lines } = run(routes({ ...BUILT, ...change }));
      expect(verdict(lines, id), show(lines)).toEqual(["FAIL"]);
      const others = CLAIMS.filter((c) => c !== id);
      for (const c of others) expect(verdict(lines, c), `${c} moved with ${id}\n${show(lines)}`).toEqual(["PASS"]);
    });
  }
});

describe("the layout and the stage", () => {
  it("a page that preloads no scanner chunk is a FAIL that names what it could not read, and judges no chunk claim", () => {
    const { lines } = run(routes({ ...BUILT, page: '<html><script type="module" src="/assets/index-E1.js"></script></html>' }));
    expect(fails(lines).map((l) => l.slice(0, 9)), show(lines)).toEqual(["FAIL  L0 "]);
    expect(line(lines, "L0")[0]).toMatch(/scanner chunk/);
    for (const id of CLAIMS) expect(line(lines, id), id).toEqual([]);
    expect(line(lines, "O3")[0], show(lines)).toMatch(/^INFO .*owner pending/);
  });

  it("a scanner chunk that names no report chunk is a FAIL", () => {
    const { lines } = run(routes({ ...BUILT, idx: sub2(NEW_IDX, "FreeKeywordResults-F1.js", "Report-F1.js") }));
    expect(verdict(lines, "L0"), show(lines)).toEqual(["FAIL"]);
  });

  it("a new scanner beside an old report chunk is a FAIL", () => {
    const { lines } = run(routes({ ...BUILT, fkr: OLD_FKR }));
    expect(fails(lines).some((l) => /^FAIL {2}L1 /.test(l)), show(lines)).toBe(true);
  });

  it("a published scanner whose CV standards chunk cannot be named fails the market claim", () => {
    const { lines } = run(routes({ ...BUILT, entry: NEW_ENTRY.replace("./CvStandards-C1.js", "./Standards-C1.js") }));
    expect(line(lines, "S14X-032")[0], show(lines)).toMatch(/^FAIL .*CV standards chunk could not be read/);
  });
});

function sub2(s: string, from: string, to: string) {
  if (!s.includes(from)) throw new Error(`the stub carries no ${from}`);
  return s.split(from).join(to);
}

describe("the owner lines", () => {
  it("S14X-012 decided B with the drip box still in the report is a FAIL", () => {
    const { lines } = run(routes(BUILT, ROUND), OWNERS);
    expect(verdict(lines, "O1"), show(lines)).toEqual(["FAIL"]);
    expect(verdict(lines, "O2"), show(lines)).toEqual(["FAIL"]);
  });

  it("S14X-012 decided A leaves the drip box alone", () => {
    const { lines } = run(routes(BUILT, ROUND), { "S14X-012": "A" });
    expect(line(lines, "O1")[0], show(lines)).toMatch(/^INFO .*decided "A"/);
  });

  it("only one alerting function at the round's build is a FAIL; neither is INFO; a missing header is a FAIL", () => {
    const half = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }, { saveLead: "save-lead.2026-11-12.1", notifyOwner: "notify-owner.2026-11-03.1" }), OWNERS);
    expect(verdict(half.lines, "O3"), show(half.lines)).toEqual(["FAIL"]);
    const none = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }), OWNERS);
    expect(line(none.lines, "O3")[0], show(none.lines)).toMatch(/^INFO .*has not landed/);
    const blind = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }, { saveLead: null, notifyOwner: "notify-owner.2026-11-12.1" }), OWNERS);
    expect(verdict(blind.lines, "O3"), show(blind.lines)).toEqual(["FAIL"]);
  });

  it("an answer recorded as an object is judged by its choice, not by the words of its rule", () => {
    const recorded = {
      "S14X-012": { choice: "B", rule: "withdraw the drip promise" },
      "S14X-101": { choice: "remove", rule: "remove the tips box; alerts carry counts or a reference only" },
    };
    const good = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }, ROUND), recorded);
    for (const id of ["O1", "O2", "O3"]) expect(verdict(good.lines, id), `${id}\n${show(good.lines)}`).toEqual(["PASS"]);
    const other = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }, ROUND), {
      "S14X-012": { choice: "A", rule: "keep the drip; option B was weighed and refused" },
      "S14X-101": { choice: "keep", rule: "do not remove the box yet" },
    });
    expect(line(other.lines, "O1")[0], show(other.lines)).toMatch(/^INFO .*decided "A"/);
    expect(line(other.lines, "O2")[0], show(other.lines)).toMatch(/^INFO .*decided "keep"/);
    expect(line(other.lines, "O3")[0], show(other.lines)).toMatch(/^INFO .*decided "keep"/);
  });

  it("a later build passes too (this round's build or later)", () => {
    const { lines } = run(routes({ ...BUILT, fkr: NEW_FKR_OWNER }, { saveLead: "save-lead.2026-11-20.1", notifyOwner: "notify-owner.2026-11-12.2" }), OWNERS);
    expect(verdict(lines, "O3"), show(lines)).toEqual(["PASS"]);
  });
});
