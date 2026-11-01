// @vitest-environment node
/**
 * SECTION 57 FAILS WHAT IT CLAIMS (fix/full-analysis-timeout).
 *
 * scripts/verify-deploy.d/57-full-analysis-timeout.sh says the branch's 23
 * functions serve 2026-10-28.1 or later and that the published success page
 * sends the page's language with each analyze-resume ask and labels the
 * report's fixed choices. Each PASS needs something that could have made it
 * FAIL (scripts/verify-deploy.d/README.md), so the section runs here on a fake
 * curl: a healthy deploy prints no FAIL; an older build, a missing build, an
 * ask without a language, a report without labels and unpublished strings
 * each print the FAIL that names them; the bundle layout moving is a FAIL,
 * never a silent pass; and the section sends only OPTIONS and GET.
 */
import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/57-full-analysis-timeout.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";

const FUNCTIONS = [
  "analyze-resume", "fetch-job-posting", "generate-application-answers", "generate-apply-package", "generate-ats-defense",
  "generate-career-path", "generate-career-snapshot", "generate-cover-letter", "generate-cover-letter-stream",
  "generate-freelance-boost", "generate-graduate-gameplan", "generate-interview-coach", "generate-keyword-fix",
  "generate-premium-package", "generate-premium-package-stream", "generate-product-preview", "generate-recruiter-view",
  "generate-resume-roast", "generate-summary", "generate-tailored-resume", "import-freelance-profile",
  "parse-resume-structured", "test-ai-fallback",
];

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
const FN = "https://p\\.supabase\\.co";

/** The Success chunk as the build writes it: three asks and the report's label lookup. */
const successChunk = (o: { language?: number; labels?: boolean } = {}) => {
  const lang = (i: number) => (i < (o.language ?? 3) ? ",language:z.language" : "");
  return [
    `import{a as A}from"./index-ENTRY001.js";import{s as S}from"./rb-en_ns_analysisResults-STR00001.js";`,
    `const f=async(w)=>{await x.functions.invoke("analyze-resume",{body:{resumeText:"",sessionId:w${lang(0)}}})};`,
    `const g=async(y,u,L,D)=>{await x.functions.invoke("analyze-resume",{body:{resumeText:y,linkedInText:u,jobDescriptionText:L,sessionId:D${lang(1)}}})};`,
    `const h=(w,A)=>x.functions.invoke("analyze-resume",{body:{resumeText:w,sessionId:A${lang(2)}}});`,
    o.labels === false ? `const l=(g,v)=>v;` : "const l=(g,v)=>t(`analysisResults.enum.${g}.${v}`);",
  ].join("");
};
const STRINGS = `const s={experienceLevel:"{{level}} level",enum:{industry:{technology:"Technology",data_engineering:"Data Engineering"},companyType:{startup:"Startup",scaleup:"Scale-up"}}};export{s};`;

interface Over { builds?: Record<string, string | null>; success?: string | null; strings?: string; entry?: string }
function routes(over: Over = {}): Route[] {
  const builds: Record<string, string | null> = { ...Object.fromEntries(FUNCTIONS.map((f) => [f, `${f}.2026-10-28.1`])), ...(over.builds ?? {}) };
  return [
    ...Object.entries(builds).map(([fn, b]) => ({ match: `^OPTIONS ${FN}/functions/v1/${fn}$`, headers: b ? { "x-fn-build": b } : {} })),
    { match: "^GET https://site\\.test/$", body: `<html><head><script type="module" crossorigin src="/assets/index-ENTRY001.js"></script></head></html>` },
    { match: "^GET https://site\\.test/assets/index-ENTRY001\\.js$", body: over.entry ?? `const r=[()=>import("./Success-SUCC0001.js"),()=>import("./Jobs-JOBS0001.js")];` },
    ...(over.success === null ? [] : [{ match: "^GET https://site\\.test/assets/Success-SUCC0001\\.js$", body: over.success ?? successChunk() }]),
    { match: "^GET https://site\\.test/assets/rb-en_ns_analysisResults-STR00001\\.js$", body: over.strings ?? STRINGS },
  ];
}

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(over: Over = {}): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-57-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes(over)));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "run.sh"), `set -u\nK=pk_test; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n` + SECTION.split("/tmp/").join(`${dir}/`));
  let out = "";
  try {
    out = execFileSync("bash", [join(dir, "run.sh")], {
      cwd: ROOT,
      env: { ...process.env, PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`, VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log") },
      encoding: "utf8", timeout: 50_000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean) };
}
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const has = (lines: string[], s: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${s}  `) && re.test(l.slice(s.length + 2)));
const show = (lines: string[]) => `\n${lines.join("\n")}`;

describe("section 57 on a healthy deploy", () => {
  it("prints no FAIL, a PASS for every function and each page claim, every line a verdict, and only OPTIONS and GET", () => {
    const { lines, calls } = run();
    expect(BUILD_GE).not.toBe("");
    expect(fails(lines), show(lines)).toEqual([]);
    for (const fn of FUNCTIONS) expect(has(lines, "PASS", new RegExp(`^${fn} x-fn-build = ${fn}\\.2026-10-28\\.1`)), `${fn}${show(lines)}`).toBe(true);
    expect(has(lines, "PASS", /sends the page's language with all 3 analyze-resume asks/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /labels its fixed choices through analysisResults\.enum/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /English strings .* carry the report's fixed-choice labels/), show(lines)).toBe(true);
    for (const l of lines.slice(1)) expect(l, l).toMatch(/^(PASS|FAIL|INFO)  /);
    expect(lines[0]).toMatch(/^== 57\. /);
    for (const c of calls) expect(c, c).toMatch(/^(OPTIONS|GET) /);
  });

  it("a later build passes too", () => {
    const { lines } = run({ builds: { "analyze-resume": "analyze-resume.2026-11-03.2" } });
    expect(fails(lines), show(lines)).toEqual([]);
  });
});

describe("each claim can fail", () => {
  it("an older build, or none, is a FAIL that names the function", () => {
    const { lines } = run({ builds: { "generate-interview-coach": "generate-interview-coach.2026-10-11.24", "fetch-job-posting": null } });
    expect(has(lines, "FAIL", /^generate-interview-coach x-fn-build = generate-interview-coach\.2026-10-11\.24, older than/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /^fetch-job-posting preflight carries no x-fn-build/), show(lines)).toBe(true);
    expect(fails(lines)).toHaveLength(2);
  });

  it("an ask without the page's language is a FAIL", () => {
    const { lines } = run({ success: successChunk({ language: 2 }) });
    expect(has(lines, "FAIL", /sends a language with 2 of its 3 analyze-resume asks/), show(lines)).toBe(true);
    expect(fails(lines)).toHaveLength(1);
  });

  it("a report that reads no label is a FAIL", () => {
    const { lines } = run({ success: successChunk({ labels: false }) });
    expect(has(lines, "FAIL", /reads no analysisResults\.enum label/), show(lines)).toBe(true);
    expect(fails(lines)).toHaveLength(1);
  });

  it("English strings without the labels are a FAIL", () => {
    const { lines } = run({ strings: `const s={experienceLevel:"{{level}} level"};export{s};` });
    expect(has(lines, "FAIL", /carry no analysisResults\.enum labels/), show(lines)).toBe(true);
    expect(fails(lines)).toHaveLength(1);
  });

  it("a moved layout is a FAIL, never a pass: no Success chunk, or no ask in the shape it reads", () => {
    const noChunk = run({ entry: `const r=[()=>import("./Jobs-JOBS0001.js")];` }).lines;
    expect(has(noChunk, "FAIL", /names no Success chunk/), show(noChunk)).toBe(true);
    expect(noChunk.filter((l) => l.startsWith("PASS") && /success page|report|English strings/.test(l))).toEqual([]);
    const noAsk = run({ success: "const nothing=1;" }).lines;
    expect(has(noAsk, "FAIL", /has no analyze-resume ask in the shape this line reads/), show(noAsk)).toBe(true);
  });
});
