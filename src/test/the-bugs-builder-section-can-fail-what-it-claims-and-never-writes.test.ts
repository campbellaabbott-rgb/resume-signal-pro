// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-builder CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-builder.sh judges the builder lane
 * of the 2026-11-08 bug round: one function build, fifteen marks in the
 * published ResumeBuilder chunk, its preview's chunk and the exporter's
 * chunks, two retired spellings, and the builder translation shard. Run here
 * against a fake curl:
 *   - production as it is today (the function at 2026-11-09.2, the page with
 *     its two delete gates, the preview asking for its English headings, no
 *     builder shard) prints no FAIL;
 *   - the function live with the old page, and the page published with the
 *     old function, print no FAIL either: either may land first;
 *   - a good deploy prints PASS for every claim;
 *   - each regression prints FAIL: a missing build header, each mark missing
 *     once any mark is published, a retired spelling still present, a shard
 *     missing or short of a string, and a bundle layout the section cannot
 *     read;
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
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-builder.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bbd";
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
  const dir = mkdtempSync(join(tmpdir(), "vdbbd-"));
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

// The chunks as production serves them on 2026-11-15 (ResumeBuilder-niSsiFkU.js,
// resume-builder-Db8UMbCk.js, resume-builder-export-Bm-ouLBE.js), cut to their
// tells: the page calls the function, imports the preview's chunk and loads
// the exporter on demand; each editor gates its delete button on length>1.
const IMPORTS = 'import{a as P}from"./resume-builder-PV.js";import{b as I}from"./builder-import-BI.js";import{s as e}from"./index-A1.js";';
const OLD_PAGE = [
  IMPORTS,
  'e.functions.invoke("parse-resume-structured",{body:{resumeText:x}});const X=()=>O(()=>import("./resume-builder-export-EX.js"),[]);',
  'a("resumeBuilder.experience.role",{num:c+1})]}),s.length>1&&e.jsx(w,{variant:"ghost"});',
  'a("resumeBuilder.education.entry",{num:p+1})]}),s.length>1&&e.jsx(w,{variant:"ghost"});',
].join("");
const OLD_PREVIEW = ["yourName", "summary", "experience", "role", "education", "skills", "certifications"].map((k) => `t("resumeBuilder.preview.${k}");`).join("");
const OLD_EXP = 'import{u as U}from"./pdf-text-support-PT.js";import{x}from"./index-A1.js";const L={de:{experience:"Berufserfahrung"}};p.splitTextToSize(t,w);new TextRun({text:t,font:F});';
const OLD_PTS = 'const W=new Set(["\\u20AC","\\u201A"]);export{W};';
// ... and as this branch builds them (the tells read from a vite build of it).
const NEW_PAGE = [
  IMPORTS,
  'e.functions.invoke("parse-resume-structured",{body:{resumeText:x}});const X=()=>O(()=>import("./resume-builder-export-EX.js"),[]);',
  'if(n===429)return r==="rate_limited_function"||r==="rate_limited_session"?"dailyLimit":"busy";',
  'const k=d.resumeTruncated===!0&&Number.isFinite(i);let s=sessionStorage.getItem("rb_builder_seed");',
  'window.addEventListener("storage",Z);window.addEventListener("beforeunload",V);',
  'return typeof l.fingerprint=="string"&&l.fingerprint!==ue(t)?(ce(),null):l;',
  'e.jsxs("fieldset",{disabled:u,"aria-busy":u,className:"m-0"});a("builderPage.importLatest");',
  'a("builderPage.importedNoneMatchedDescription",{count:g});const ct=t=>`builder-contact-${t}`;',
  'a("resumeBuilder.experience.role",{num:c+1});a("builderPage.moveUp");a("builderPage.moveDown");a("builderPage.removeEntry");',
].join("");
const NEW_PREVIEW = 't("resumeBuilder.preview.yourName");const X={tl:{summary:"Buod",experience:"Karanasan sa Trabaho"}};';
const NEW_EXP = 'import{u as U}from"./pdf-text-support-PT.js";import{x}from"./index-A1.js";p.splitTextToSize(t,w);new Paragraph({keepNext:!0});new TextRun({text:l,font:F,break:1});';
const NEW_PTS = 'const G={"\\uFB00":"ff","\\uFB01":"fi","\\uFB03":"ffi","\\uFB04":"ffl"};';

const LNGS = ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"];
const SHARD_KEYS = ["importFailed", "importTruncated", "importLatest", "otherTab", "storageBlocked", "moveUp", "removeEntry", "removeBullet", "bullet", "importedNoneMatchedDescription_other"];
const SHARD = (lng: string, drop: string[] = []) => `const a={${SHARD_KEYS.filter((k) => !drop.includes(k)).map((k) => `${k}:"${lng} ${k}"`).join(",")}};export{a as default};`;
const OTHER_SHARDS = 'const r={"./shards/company/de.json":()=>O(()=>import("./de-Co1.js"),[]),"./shards/company/en.json":jN};';
const OLD_ENTRY = `const m=["assets/ResumeBuilder-RB.js"];${OTHER_SHARDS}`;
const NEW_ENTRY = (lngs: string[] = LNGS, en = true) =>
  `const m=["assets/ResumeBuilder-RB.js"];${OTHER_SHARDS}const q={${en ? '"./shards/builder/en.json":kN,' : ""}${lngs.map((l) => `"./shards/builder/${l}.json":()=>O(()=>import("./${l}-Bd${l.replace("-", "")}.js"),[])`).join(",")}};`;

type Over = Partial<{
  fn: string | null;
  home: string; entry: string; page: string; preview: string; exp: string; pts: string;
  shard: Record<string, string>;
}>;

function routes(o: Over = {}, fns = true, fe = true): Route[] {
  const fn = o.fn === undefined ? (fns ? "parse-resume-structured.2026-11-12.1" : "parse-resume-structured.2026-11-09.2") : o.fn;
  return [
    { match: `^OPTIONS ${P}/functions/v1/parse-resume-structured$`, headers: fn ? { "x-fn-build": fn } : {} },
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: o.entry ?? (fe ? NEW_ENTRY() : OLD_ENTRY) },
    { match: `^GET ${S}/assets/ResumeBuilder-RB\\.js$`, body: o.page ?? (fe ? NEW_PAGE : OLD_PAGE) },
    { match: `^GET ${S}/assets/builder-import-BI\\.js$`, body: 'export const b=()=>"resumeBuilderImportedFrom";' },
    { match: `^GET ${S}/assets/resume-builder-PV\\.js$`, body: o.preview ?? (fe ? NEW_PREVIEW : OLD_PREVIEW) },
    { match: `^GET ${S}/assets/resume-builder-export-EX\\.js$`, body: o.exp ?? (fe ? NEW_EXP : OLD_EXP) },
    { match: `^GET ${S}/assets/pdf-text-support-PT\\.js$`, body: o.pts ?? (fe ? NEW_PTS : OLD_PTS) },
    ...LNGS.map((l) => ({ match: `^GET ${S}/assets/${l}-Bd${l.replace("-", "")}\\.js$`, body: o.shard?.[l] ?? SHARD(l) })),
  ];
}

const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const MARKS = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12", "L1", "E1", "E2", "E3"];
const CLAIMS = ["F1", ...MARKS, "N1", "N2", "S1"];
const claim = (verdict: string, c: string) => new RegExp(`^${verdict} {2}${c} `);

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false, false));
  it("prints no FAIL: every claim not yet shipped is INFO", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}N1 .*holds 2 \.length>1&& gate/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}N2 .*resumeBuilder\.preview\.experience/), show(lines)).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz-bugs-builder\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("either half may land first", () => {
  it("the function live with the old page: the build passes, the page waits, nothing fails", () => {
    const { lines } = run(routes({}, true, false));
    expect(fails(lines), show(lines)).toEqual([]);
    expect(has(lines, "PASS", claim("PASS", "F1")), show(lines)).toBe(true);
    for (const c of [...MARKS, "N1", "N2", "S1"]) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("the page published with the old function: the marks pass, the build waits, nothing fails", () => {
    const { lines } = run(routes({}, false, true));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of [...MARKS, "N1", "N2", "S1"]) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", claim("INFO", "F1")), show(lines)).toBe(true);
  });
});

describe("a good deploy", () => {
  const { lines, calls } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("a later build of the function still passes", () => {
    const later = run(routes({ fn: "parse-resume-structured.2026-11-20.1" })).lines;
    expect(has(later, "PASS", claim("PASS", "F1")), show(later)).toBe(true);
  });
  it("the fingerprint comparison passes in either order the minifier writes it", () => {
    const flipped = run(routes({ page: NEW_PAGE.replace("l.fingerprint!==ue(t)", "ue(t)!==l.fingerprint") })).lines;
    expect(has(flipped, "PASS", claim("PASS", "P8")), show(flipped)).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted", () => {
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
  });
});

describe("each regression prints FAIL", () => {
  it("F1: the preflight carries no build header", () => {
    expect(has(run(routes({ fn: null })).lines, "FAIL", /^FAIL {2}F1 parse-resume-structured preflight carries no x-fn-build/)).toBe(true);
  });

  // Each mark's tell, as the published chunk spells it; removing it alone must fail that claim alone.
  const TELLS: Record<string, [keyof Over, string]> = {
    P1: ["page", "rate_limited_function"],
    P2: ["page", "resumeTruncated"],
    P3: ["page", "rb_builder_seed"],
    P4: ["page", 'addEventListener("storage"'],
    P5: ["page", '"fieldset",{disabled:'],
    P6: ["page", 'addEventListener("beforeunload"'],
    P7: ["page", "builderPage.importLatest"],
    P8: ["page", ".fingerprint!=="],
    P9: ["page", "builderPage.importedNoneMatchedDescription"],
    P10: ["page", "builder-contact-"],
    P11: ["page", "builderPage.moveUp"],
    P12: ["page", "builderPage.removeEntry"],
    L1: ["preview", "Karanasan sa Trabaho"],
    E1: ["exp", "keepNext:!0"],
    E2: ["exp", "break:1"],
    E3: ["pts", ':"ffl"'],
  };
  const BASE: Record<string, string> = { page: NEW_PAGE, preview: NEW_PREVIEW, exp: NEW_EXP, pts: NEW_PTS };
  it.each(MARKS)("%s: its tell missing once the rest are published", (c) => {
    const [file, tell] = TELLS[c];
    expect(BASE[file]).toContain(tell);
    const { lines } = run(routes({ [file]: BASE[file].split(tell).join("x") }));
    expect(has(lines, "FAIL", claim("FAIL", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", c).test(l)), show(lines)).toEqual([]);
  });

  it("N1: a delete button gated on length>1 again, once published", () => {
    const { lines } = run(routes({ page: `${NEW_PAGE}s.length>1&&e.jsx(w,{variant:"ghost"});` }));
    expect(has(lines, "FAIL", /^FAIL {2}N1 .*still holds 1 \.length>1&& gate/), show(lines)).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", "N1").test(l)), show(lines)).toEqual([]);
  });

  it("N2: the preview asks for an English heading again, once published", () => {
    const { lines } = run(routes({ preview: `${NEW_PREVIEW}t("resumeBuilder.preview.experience");` }));
    expect(has(lines, "FAIL", /^FAIL {2}N2 .*asks for resumeBuilder\.preview\.experience/), show(lines)).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", "N2").test(l)), show(lines)).toEqual([]);
  });

  it("S1: seven shards, a shard short of a string, no English shard, no shard at all once published", () => {
    expect(has(run(routes({ entry: NEW_ENTRY(LNGS.slice(1)) })).lines, "FAIL", /^FAIL {2}S1 .*names 7 non-English builder shards, not 8/)).toBe(true);
    const short = run(routes({ shard: { hi: SHARD("hi", ["storageBlocked"]) } })).lines;
    expect(has(short, "FAIL", /^FAIL {2}S1 .*missing: hi:storageBlocked$/), show(short)).toBe(true);
    expect(has(run(routes({ entry: NEW_ENTRY(LNGS, false) })).lines, "FAIL", /^FAIL {2}S1 .*not the English one/)).toBe(true);
    expect(has(run(routes({ entry: OLD_ENTRY })).lines, "FAIL", /^FAIL {2}S1 .*published but the entry loads no builder shard/)).toBe(true);
  });

  it("a layout the section cannot read: no entry, no page chunk calling the function, no preview chunk, no exporter", () => {
    expect(has(run(routes({ home: "<html></html>" })).lines, "FAIL", /^FAIL {2}P1 the homepage names no/)).toBe(true);
    expect(has(run(routes({ page: NEW_PAGE.split("parse-resume-structured").join("x") })).lines, "FAIL", /^FAIL {2}P1 .*names no ResumeBuilder chunk that calls parse-resume-structured/)).toBe(true);
    expect(has(run(routes({ preview: "export const z=1;" })).lines, "FAIL", /^FAIL {2}L1 neither the ResumeBuilder chunk .*resumeBuilder\.preview\.yourName/)).toBe(true);
    expect(has(run(routes({ exp: NEW_EXP.split("splitTextToSize").join("x") })).lines, "FAIL", /^FAIL {2}E1 no chunk the ResumeBuilder chunk .*splitTextToSize/)).toBe(true);
  });
});
