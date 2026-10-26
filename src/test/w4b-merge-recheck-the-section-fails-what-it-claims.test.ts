// @vitest-environment node
/**
 * SECTION 92 (THE RECHECK OF THE MERGE OF MAIN) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-merge-recheck.sh is what the owner reads
 * after wave 4 deploys. A PASS is worth something only if a regression could
 * have turned it into a FAIL (verify-deploy.d/README), so the section runs
 * here in bash against a fake curl, with the real build_ge cut from the
 * verifier. The healthy site is this checkout's own offline bake; the old one
 * is what production served on 2026-10-25 (read as Googlebot). A healthy
 * deploy prints no FAIL; the old layoff-filings build, the old /pricing, each
 * old fit-is-paid page, the old Meta answer and Tapestry rows read as nothing
 * each print FAIL; and the section only sends OPTIONS, GET and two job-board
 * list reads on the probe budget.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-merge-recheck.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null,budget="";
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="-H"){const h=a[++i];if(/^x-rb-budget:/i.test(h))budget=h;}else if(["-m","-A"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const key=method+" "+url+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,key+(budget?" ["+budget+"]":"")+"\\n");
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
let BAKE = "";
beforeAll(() => {
  BAKE = mkdtempSync(join(tmpdir(), "vd-92m-bake-"));
  dirs.push(BAKE);
  mkdirSync(join(BAKE, "dist"), { recursive: true });
  copyFileSync(join(ROOT, "index.html"), join(BAKE, "dist", "index.html"));
  execFileSync("node", [join(ROOT, "scripts/prerender-seo.mjs")], {
    cwd: ROOT, env: { ...process.env, PRERENDER_OUT: BAKE, PRERENDER_OFFLINE: "1", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
}, 300_000);
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "vd-92m-"));
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
const pad = "x".repeat(1200);
const META_NOW = JSON.stringify({ jobs: [], total: 0, unknownCompanies: ["Meta"], companiesUnresolved: [{ asked: "Meta", candidates: [{ token: "Meta1", name: "Meta", open: 4, vendor: "smartrecruiters", agency: true }], held: "agency" }] });
const META_OLD = JSON.stringify({ jobs: [{ id: "smartrecruiters:Meta1:1", title: "Mailroom Clerk", agency: false }], total: 4, companiesResolved: [{ asked: "Meta", name: "Meta", tokens: ["Meta1"] }] });
const tap = (minYears: number | null) => JSON.stringify({ jobs: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, title: "Seasonal Sales Associate", ...(minYears === null ? {} : { minYears: i < 20 ? minYears : 2 }) })), total: 874 });
const PRICING_OLD = `<html><head><title>Pricing — Free Resume Scan, One-Time Tools from $5</title><meta name="description" content="One-time tools $5–$5; Pro $45/month."></head><body><p>Paid tools are one-time purchases, not subscriptions.</p><h2>One-time tools</h2><p>Current bundle discounts are shown live on this page in the app.</p>${pad}</body></html>`;
const DATAAPI_OLD = `<html><body><ul><li><code>POST /v1/fit</code> (paid) — a résumé in, the board's best matches out, scored with matched and missing terms; stores nothing.</li></ul>${pad}</body></html>`;
const AGENTS_OLD = `<html><body><p>Read tools work with any free API key. <code>fit_resume</code> needs a paid key, exactly like <code>POST /v1/fit</code> on the data API.</p>${pad}</body></html>`;
const LLMS_OLD = `${pad}\n- [Hiring Data & API](https://resumebooster.work/data-api): GET /v1/jobs, /v1/usage, POST /v1/fit (paid). Cursor pagination, ETags.\n`;
const LLMSFULL_OLD = `${pad}\n- MCP server: every other read tool needs a free key, and fit_resume a paid key. A key travels in a header.\n`;

function healthy(over: Partial<Record<"build" | "pricing" | "dataapi" | "agents" | "llms" | "llmsfull" | "meta" | "tap", string>> = {}): Route[] {
  const page = (p: string) => readFileSync(join(BAKE, "dist", ...p.split("/").filter(Boolean), "index.html"), "utf8");
  return [
    { match: `^OPTIONS ${FN}/layoff-filings$`, headers: over.build === "" ? {} : { "x-fn-build": over.build ?? "layoff-filings.2026-10-11.1" } },
    { match: "^GET https://site\\.test/pricing$", body: over.pricing ?? page("/pricing") },
    { match: "^GET https://site\\.test/data-api$", body: over.dataapi ?? page("/data-api") },
    { match: "^GET https://site\\.test/agents$", body: over.agents ?? page("/agents") },
    { match: "^GET https://site\\.test/llms\\.txt$", body: over.llms ?? readFileSync(join(BAKE, "public", "llms.txt"), "utf8") },
    { match: "^GET https://site\\.test/llms-full\\.txt$", body: over.llmsfull ?? readFileSync(join(BAKE, "dist", "llms-full.txt"), "utf8") },
    { match: `^POST ${FN}/job-board .*"companies":\\["Meta"\\]`, body: over.meta ?? META_NOW },
    { match: `^POST ${FN}/job-board .*tapestry`, body: over.tap ?? tap(1) },
  ];
}

describe("section 92, the recheck of the merge of main", () => {
  it("a healthy deploy, read from this checkout's own bake, prints no FAIL, and only reads", () => {
    const { lines, calls } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toHaveLength(8);
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      if (c.startsWith("POST ")) expect(c, "a POST is a job-board list read on the probe budget").toMatch(/\/functions\/v1\/job-board \{"action":"list".*\[x-rb-budget: probe\]$/);
      else expect(c).toMatch(/^(OPTIONS|GET) /);
    }
  });

  it("the old layoff-filings build reads FAIL, and a missing header too", () => {
    expect(has(run(healthy({ build: "layoff-filings.2026-10-09.3" })).lines, "FAIL", /layoff-filings x-fn-build = layoff-filings\.2026-10-09\.3/)).toBe(true);
    expect(has(run(healthy({ build: "" })).lines, "FAIL", /layoff-filings preflight carries no x-fn-build/)).toBe(true);
  });

  it("the old /pricing reads FAIL, naming each sentence", () => {
    const { lines } = run(healthy({ pricing: PRICING_OLD }));
    expect(has(lines, "FAIL", /One-Time Tools title, a one-price range \(\$5–\$5\), a bundle discount, the list lead/), show(lines)).toBe(true);
  });

  it("each old fit-is-paid document reads FAIL", () => {
    const { lines } = run(healthy({ dataapi: DATAAPI_OLD, agents: AGENTS_OLD, llms: LLMS_OLD, llmsfull: LLMSFULL_OLD }));
    for (const name of ["/data-api", "/agents", "/llms.txt", "/llms-full.txt"]) expect(has(lines, "FAIL", new RegExp(`^FAIL {2}${name.replace(/[.]/g, "\\.")} still pairs fit scoring with paid`)), `${name}${show(lines)}`).toBe(true);
  });

  it("Meta resolved to the staffing board reads FAIL", () => {
    expect(has(run(healthy({ meta: META_OLD })).lines, "FAIL", /companies:\["Meta"\] serves 4 rows and holds nothing/)).toBe(true);
  });

  it("Tapestry rows whose required year was dropped read FAIL", () => {
    const { lines } = run(healthy({ tap: tap(null).replace(/"title"/g, '"minYears":null,"title"') }));
    expect(has(lines, "PASS", /Tapestry/), show(lines)).toBe(false);
    expect(has(run(healthy({ tap: JSON.stringify({ jobs: Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, minYears: i < 5 ? 1 : 3 })) }) })).lines, "FAIL", /5 of the 30 that carry a figure say minYears 1/)).toBe(true);
  });
});
