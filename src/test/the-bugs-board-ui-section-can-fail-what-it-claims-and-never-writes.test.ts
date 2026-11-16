// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzzzzz-bugs-board-ui CAN FAIL WHAT IT CLAIMS, NEVER FAILS
 * ON TODAY'S PRODUCTION, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzzz-bugs-board-ui.sh judges the board-ui
 * lane of the 2026-11-08 bug round: two function builds, twenty-seven marks
 * in the published Jobs chunk (with every chunk it imports) and the free
 * report's matches chunk, three retired spellings, and the board-ui
 * translation shard. Run here against a fake curl:
 *   - production as it is today (both functions at 2026-11-09.1, the Jobs
 *     chunk printing revenue as dollars, the compare sheet's raw age, the
 *     share-of-keywords sentence, no board-ui shard) prints no FAIL;
 *   - the functions live with the old page, and the page published with the
 *     old functions, print no FAIL either: either may land first;
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
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-board-ui.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_bui";
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
  const dir = mkdtempSync(join(tmpdir(), "vdbui-"));
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

// The chunks as production serves them on 2026-11-15 (index-6OaKujjA.js,
// Jobs-DtT-e-aO.js with its imports, ATSParseSimulator-H0MKeP0Y.js), cut to
// their tells. The entry's toaster CSS carries "(pointer: coarse)" and an
// imported filter-bar chunk the keyword label: neither is the board's mark.
const IMPORTS = 'import{a as C}from"./JobCard-JC.js";import{b as F}from"./board-facets-BF.js";import{c as N}from"./company-display-CD.js";import{s as e}from"./index-A1.js";';
const OLD_JOBS = [
  IMPORTS,
  't("jobsPage.compareTitle","Side by side");"data-board-new-today":"",company:se.length===1?se[0]:void 0,country:ce,',
  'r.revenue>=1e9?`$${(r.revenue/1e9).toFixed(1)}B`:`$${Math.round(r.revenue/1e6)}M`;t("jobsPage.postedDaysAgo",{n:d});t("jobsPage.matchCoverage",{pct:p});',
  'const lap=r.observability_bucket==="lap_pending";s.recheckedAt&&Date.now()-Date.parse(s.recheckedAt)>Kp*36e5&&Ie({action:"verify",ids:[s.id]}).catch(()=>{});',
  'l&&Ie({action:"list",q:l,limit:12,includeFacets:!1}).then(m=>m);',
].join("");
const OLD_CARD = 't("jobsPage.matchCoverage",{pct:p});t("filterBar.keywordLabel");';
const OLD_FACETS = 'await T({body:{action:"list",countOnly:!0,includeFacets:!1,...R(c.params??{}),postedAfter:c.last_seen_at}});[e.q,e.company].filter(Boolean).join(" · ");';
const NAMES = 'const o=[["recruiting2~CON1074CVTG","Convergint"]];';
const OLD_MATCHES = 'import{x}from"./index-A1.js";t("freeResults.matches.loading");t("freeResults.matches.openBoard");';
// ... and as this branch builds them (the tells read from a vite build of it).
const NEW_JOBS = [
  IMPORTS,
  't("jobsPage.compareTitle","Side by side");p.delete("company");"data-board-new-today":"board",company:se.length===1?se[0]:void 0,companies:pe,country:ce,',
  't("jobsPage.employerCtx.publicCo",{rev:Gt(r.revenue,r.currency,i.language)});"data-compare-age":"",',
  't("boardUi.fitRankedFilters");t("boardUi.handoffWithheld");t("boardUi.recordOneBoard");n.jsx(Le,{to:"/account#pipeline"});',
  'window.matchMedia("(pointer: coarse)").matches;n.jsx(Dt,{"data-compare-dialog":""});',
  '!ad.includes(String(r.observability_bucket??""))||Date.now()-Date.parse(s.recheckedAt)>cd*36e5||(Mc.current.add(s.id),De({action:"verify",ids:[s.id]}).catch(()=>{}));',
  'Ee(f.sort==="newest"&&typeof f.q=="string"&&f.q.trim()!=="");t("boardUi.nlUnavailable");t("boardUi.nlNothingRead");',
  'n.jsxs("span",{"data-fit-limited":""});t("boardUi.salaryFromSearch",{amount:a});sessionStorage.getItem("rb_board_pending");',
  'for(let S=2;S<=9&&(x==null?void 0:x.code)==="23505";S++){const P=`${m} (${S})`;x=await f(P)}',
  'function tu(e){const o=pf(e);return o.kind==="dated"?o.days:null}n.jsxs("div",{ref:a,tabIndex:-1,"data-shortcuts-card":""});',
  'n.jsx("input",{id:"board-search","aria-label":t("filterBar.keywordLabel","Search jobs by title or keyword")});',
  'c&&De({action:"list",q:c,limit:12,includeFacets:!1,...ic}).then(m=>m);',
].join("");
const NEW_CARD = 'r==="no_recognised_terms"?t("boardUi.unscoredTerms"):null;';
const NEW_FACETS = 'await S({body:{action:"list",countOnly:!0,includeFacets:!1,...W(m.params??{}),newSince:m.last_seen_at}});[e.q,i?c>0?`${i} +${c} more`:i:""].filter(Boolean).join(" · ");';
const NEW_MATCHES = `${OLD_MATCHES}t("boardUi.fitLimitedHour",{n:h});t("boardUi.matchesNoneForRole",{role:r});`;

const LNGS = ["de", "en-GB", "es", "fr", "hi", "nl", "pt", "tl"];
const SHARD_KEYS = ["nlLabel", "nlRunAsKeywords", "nlUnavailable", "nlNothingRead", "yearsFromSearch", "salaryFromSearch", "salaryCeilingFromSearch", "compareDescription", "recordOneBoard", "handoffWithheld", "handoffWithheldSearch", "fitRankedFilters", "fitScoreTip", "fitNotScoredLimit", "fitNotScoredFailed", "fitLimitedHour", "fitLimitedDay", "fitLimitedPlain", "unscoredTerms", "unscoredTermsBody", "unscoredTermsTip", "matchesNoneForRole"];
const SHARD = (lng: string, drop: string[] = []) => `const e={${SHARD_KEYS.filter((k) => !drop.includes(k)).map((k) => `${k}:"${lng} ${k}"`).join(",")}};export{e as default};`;
const OLD_ENTRY_NAMES = '["assets/Jobs-JB.js","assets/ATSParseSimulator-AT.js","assets/ProductSuccess-PS.js"]';
const OLD_ENTRY = `const m=${OLD_ENTRY_NAMES};const css="@media (pointer: coarse){[data-sonner-toaster]{}}";const r={"./shards/company/en.json":jN,"./shards/company/de.json":()=>O(()=>import("./de-Co1.js"),[])};`;
const NEW_ENTRY = (lngs: string[] = LNGS, en = true, enDrop: string[] = []) =>
  `${OLD_ENTRY}${en ? `const CN={${SHARD_KEYS.filter((k) => !enDrop.includes(k)).map((k) => `${k}:"en ${k}"`).join(",")}};` : ""}const q={${en ? '"./shards/board-ui/en.json":kN,' : ""}${lngs.map((l) => `"./shards/board-ui/${l}.json":()=>O(()=>import("./${l}-Bu${l.replace("-", "")}.js"),[])`).join(",")}};`;

type Over = Partial<{
  fj: string | null; fn: string | null;
  home: string; entry: string; jobs: string; card: string; facets: string; names: string; matches: string; ps: string;
  extra: Route[];
  shard: Record<string, string>;
}>;

function routes(o: Over = {}, fns = true, fe = true): Route[] {
  const fj = o.fj === undefined ? (fns ? "job-fit.2026-11-12.1" : "job-fit.2026-11-09.1") : o.fj;
  const fnl = o.fn === undefined ? (fns ? "nl-search.2026-11-12.1" : "nl-search.2026-11-09.1") : o.fn;
  return [
    ...(o.extra ?? []),
    { match: `^OPTIONS ${P}/functions/v1/job-fit$`, headers: fj ? { "x-fn-build": fj } : {} },
    { match: `^OPTIONS ${P}/functions/v1/nl-search$`, headers: fnl ? { "x-fn-build": fnl } : {} },
    { match: `^GET ${S}/$`, body: o.home ?? '<html><head><script type="module" src="/assets/index-A1.js"></script></head></html>' },
    { match: `^GET ${S}/assets/index-A1\\.js$`, body: o.entry ?? (fe ? NEW_ENTRY() : OLD_ENTRY) },
    { match: `^GET ${S}/assets/Jobs-JB\\.js$`, body: o.jobs ?? (fe ? NEW_JOBS : OLD_JOBS) },
    { match: `^GET ${S}/assets/JobCard-JC\\.js$`, body: o.card ?? (fe ? NEW_CARD : OLD_CARD) },
    { match: `^GET ${S}/assets/board-facets-BF\\.js$`, body: o.facets ?? (fe ? NEW_FACETS : OLD_FACETS) },
    { match: `^GET ${S}/assets/company-display-CD\\.js$`, body: o.names ?? NAMES },
    { match: `^GET ${S}/assets/ATSParseSimulator-AT\\.js$`, body: o.matches ?? (fe ? NEW_MATCHES : OLD_MATCHES) },
    { match: `^GET ${S}/assets/ProductSuccess-PS\\.js$`, body: o.ps ?? 'import{a}from"./ATSParseSimulator-AT.js";import{s}from"./index-A1.js";' },
    ...LNGS.map((l) => ({ match: `^GET ${S}/assets/${l}-Bu${l.replace("-", "")}\\.js$`, body: o.shard?.[l] ?? SHARD(l) })),
  ];
}

const has = (lines: string[], verdict: string, re: RegExp) => lines.some((l) => l.startsWith(verdict) && re.test(l));
const show = (lines: string[]) => lines.join("\n");
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const PAGE_MARKS = Array.from({ length: 25 }, (_, i) => `P${i + 1}`);
const MARKS = [...PAGE_MARKS, "M1", "M2"];
const FE_CLAIMS = [...MARKS, "N1", "N2", "N3", "S1"];
const CLAIMS = ["F1", "F2", ...FE_CLAIMS];
const claim = (verdict: string, c: string) => new RegExp(`^${verdict} {2}${c} `);

describe("today's production, before the merge and the paste", () => {
  const { lines, out } = run(routes({}, false, false));
  it("prints no FAIL: every claim not yet shipped is INFO", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}N1 .*holds revenue\/1e9: not published yet/), show(lines)).toBe(true);
    expect(has(lines, "INFO", /^INFO {2}N3 .*holds jobsPage\.matchCoverage: not published yet/), show(lines)).toBe(true);
  });
  it("every line is a verdict or the header, and the key is never printed", () => {
    expect(lines.every((l) => /^(PASS|FAIL|INFO) /.test(l) || /^== 99zzzzzzz-bugs-board-ui\. /.test(l)), show(lines)).toBe(true);
    expect(out).not.toContain(KEY);
  });
});

describe("either half may land first", () => {
  it("the functions live with the old page: the builds pass, the page waits, nothing fails", () => {
    const { lines } = run(routes({}, true, false));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of ["F1", "F2"]) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
    for (const c of FE_CLAIMS) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("the page published with the old functions: the marks pass, the builds wait, nothing fails", () => {
    const { lines } = run(routes({}, false, true));
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of FE_CLAIMS) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
    for (const c of ["F1", "F2"]) expect(has(lines, "INFO", claim("INFO", c)), `${c}\n${show(lines)}`).toBe(true);
  });
});

describe("a good deploy", () => {
  const { lines, calls } = run(routes());
  it("prints PASS for every claim and no FAIL", () => {
    expect(fails(lines), show(lines)).toEqual([]);
    for (const c of CLAIMS) expect(has(lines, "PASS", claim("PASS", c)), `${c}\n${show(lines)}`).toBe(true);
  });
  it("a later build of either function still passes", () => {
    const later = run(routes({ fj: "job-fit.2026-11-20.1", fn: "nl-search.2026-12-01.3" })).lines;
    for (const c of ["F1", "F2"]) expect(has(later, "PASS", claim("PASS", c)), show(later)).toBe(true);
  });
  it("asks only with GET and OPTIONS: nothing is posted", () => {
    expect(calls.length).toBeGreaterThan(10);
    for (const c of calls) expect(c, c).toMatch(/^curl\t(GET|OPTIONS) /);
  });
  it("the Orbital row is reported, never judged", () => {
    expect(has(lines, "INFO", /^INFO {2}I1 .*no Orbital Engineering row yet/), show(lines)).toBe(true);
    const named = run(routes({ names: `${NAMES}const p=[["recruiting~ORB1000OENG","Orbital Engineering"]];` })).lines;
    expect(has(named, "INFO", /^INFO {2}I1 .*Orbital Engineering row is live/), show(named)).toBe(true);
    expect(named.some((l) => /^(PASS|FAIL) {2}I1 /.test(l)), show(named)).toBe(false);
  });
  it("finds the report's matches in a chunk its page imports when the entry no longer names it", () => {
    const moved = run(routes({
      entry: NEW_ENTRY().replace('"assets/ATSParseSimulator-AT.js",', ""),
      ps: 'import{a}from"./report-RM.js";import{s}from"./index-A1.js";',
      extra: [{ match: `^GET ${S}/assets/report-RM\\.js$`, body: NEW_MATCHES }],
    })).lines;
    expect(fails(moved), show(moved)).toEqual([]);
    for (const c of ["M1", "M2"]) expect(has(moved, "PASS", new RegExp(`^PASS {2}${c} .*\\(report-RM\\.js\\)$`)), show(moved)).toBe(true);
  });
});

describe("each regression prints FAIL", () => {
  it("F1, F2: a preflight carries no build header", () => {
    expect(has(run(routes({ fj: null })).lines, "FAIL", /^FAIL {2}F1 job-fit preflight carries no x-fn-build/)).toBe(true);
    expect(has(run(routes({ fn: null })).lines, "FAIL", /^FAIL {2}F2 nl-search preflight carries no x-fn-build/)).toBe(true);
  });

  // Each mark's tell, as the published chunk spells it; removing it alone must fail that claim alone.
  const TELLS: Record<string, [keyof Over, string]> = {
    P1: ["jobs", '.delete("company")'],
    P2: ["jobs", '"data-board-new-today":"board"'],
    P3: ["jobs", ",companies:"],
    P4: ["card", "no_recognised_terms"],
    P5: ["jobs", "boardUi.fitRankedFilters"],
    P6: ["jobs", "boardUi.handoffWithheld"],
    P7: ["jobs", "boardUi.recordOneBoard"],
    P8: ["jobs", "/account#pipeline"],
    P9: ["jobs", "(pointer: coarse)"],
    P10: ["jobs", "data-compare-dialog"],
    P11: ["jobs", "data-compare-age"],
    P12: ["jobs", "observability_bucket"],
    P13: ["jobs", '.sort==="newest"'],
    P14: ["jobs", "boardUi.nlUnavailable"],
    P15: ["jobs", "boardUi.nlNothingRead"],
    P16: ["jobs", "data-fit-limited"],
    P17: ["jobs", "boardUi.salaryFromSearch"],
    P18: ["jobs", "rb_board_pending"],
    P19: ["jobs", "<=9&&"],
    P20: ["facets", "newSince:"],
    P21: ["jobs", 'kind==="dated"'],
    P22: ["facets", " more`"],
    P23: ["jobs", "data-shortcuts-card"],
    P24: ["jobs", '"aria-label":'],
    P25: ["jobs", "includeFacets:!1,..."],
    M1: ["matches", "boardUi.fitLimited"],
    M2: ["matches", "boardUi.matchesNoneForRole"],
  };
  const BASE: Record<string, string> = { jobs: NEW_JOBS, card: NEW_CARD, facets: NEW_FACETS, matches: NEW_MATCHES };
  it.each(MARKS)("%s: its tell missing once the rest are published", (c) => {
    const [file, tell] = TELLS[c];
    expect(BASE[file]).toContain(tell);
    const { lines } = run(routes({ [file]: BASE[file].split(tell).join("x") }));
    expect(has(lines, "FAIL", claim("FAIL", c)), `${c}\n${show(lines)}`).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", c).test(l)), show(lines)).toEqual([]);
  });

  it("N1: the dollar revenue template is back, once published", () => {
    const { lines } = run(routes({ jobs: `${NEW_JOBS}r.revenue>=1e9?\`$\${(r.revenue/1e9).toFixed(1)}B\`:"";` }));
    expect(has(lines, "FAIL", /^FAIL {2}N1 .*still holds revenue\/1e9$/), show(lines)).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", "N1").test(l)), show(lines)).toEqual([]);
  });

  it("N2: the compare sheet asks for the raw-date sentence again, once published", () => {
    const { lines } = run(routes({ jobs: `${NEW_JOBS}t("jobsPage.postedDaysAgo",{n:d});` }));
    expect(has(lines, "FAIL", /^FAIL {2}N2 .*still holds jobsPage\.postedDaysAgo$/), show(lines)).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", "N2").test(l)), show(lines)).toEqual([]);
  });

  it("N3: a board chunk asks for the share-of-keywords sentence again, once published", () => {
    const { lines } = run(routes({ card: `${NEW_CARD}t("jobsPage.matchCoverage",{pct:p});` }));
    expect(has(lines, "FAIL", /^FAIL {2}N3 .*still holds jobsPage\.matchCoverage$/), show(lines)).toBe(true);
    expect(fails(lines).filter((l) => !claim("FAIL", "N3").test(l)), show(lines)).toEqual([]);
  });

  it("S1: seven shards, a shard short of a string, an English string missing, no English shard, no shard at all once published", () => {
    expect(has(run(routes({ entry: NEW_ENTRY(LNGS.slice(1)) })).lines, "FAIL", /^FAIL {2}S1 .*names 7 non-English board-ui shards, not 8/)).toBe(true);
    const short = run(routes({ shard: { hi: SHARD("hi", ["unscoredTermsTip"]) } })).lines;
    expect(has(short, "FAIL", /^FAIL {2}S1 .*missing: hi:unscoredTermsTip$/), show(short)).toBe(true);
    const en = run(routes({ entry: NEW_ENTRY(LNGS, true, ["matchesNoneForRole"]) })).lines;
    expect(has(en, "FAIL", /^FAIL {2}S1 .*missing: en:matchesNoneForRole$/), show(en)).toBe(true);
    expect(has(run(routes({ entry: NEW_ENTRY(LNGS, false) })).lines, "FAIL", /^FAIL {2}S1 .*not the English one/)).toBe(true);
    expect(has(run(routes({ entry: OLD_ENTRY })).lines, "FAIL", /^FAIL {2}S1 .*published but the entry loads no board-ui shard/)).toBe(true);
  });

  it("a layout the section cannot read: no entry, no Jobs chunk, no saved-search chunk, no report matches", () => {
    expect(has(run(routes({ home: "<html></html>" })).lines, "FAIL", /^FAIL {2}P1 the homepage names no/)).toBe(true);
    expect(has(run(routes({ entry: NEW_ENTRY().replace('"assets/Jobs-JB.js",', "") })).lines, "FAIL", /^FAIL {2}P1 .*names no Jobs chunk holding the board's compare sheet \(none named\)/)).toBe(true);
    expect(has(run(routes({ jobs: NEW_JOBS.split("jobsPage.compareTitle").join("x") })).lines, "FAIL", /^FAIL {2}P1 .*names no Jobs chunk holding the board's compare sheet \(Jobs-JB\.js\)/)).toBe(true);
    expect(has(run(routes({ facets: NEW_FACETS.split("last_seen_at").join("x") })).lines, "FAIL", /^FAIL {2}P20 neither the Jobs chunk .*last_seen_at/)).toBe(true);
    expect(has(run(routes({ matches: "export const z=1;" })).lines, "FAIL", /^FAIL {2}M1 no chunk the entry names for the free report holds its matches/)).toBe(true);
  });
});
