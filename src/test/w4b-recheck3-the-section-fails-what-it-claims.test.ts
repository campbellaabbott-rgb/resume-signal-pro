// @vitest-environment node
/**
 * SECTION 92 (RECHECK 3) FAILS WHAT IT CLAIMS.
 *
 * scripts/verify-deploy.d/92-w4b-recheck3.sh runs here in bash against a fake
 * curl, with the real build_ge cut from the verifier. The healthy site is this
 * checkout's own offline bake with purchases closed, as it ships; the old one
 * is what production served on 2026-10-26 (an AggregateOffer up to $45 on
 * /pricing, no "Purchases open soon", State Farm held as an agency's board and
 * named uncarried). A healthy deploy prints no FAIL, each old answer prints
 * FAIL, an open shop with an offer passes, and the section only sends OPTIONS,
 * GET and one job-board list read on the probe budget.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/92-w4b-recheck3.sh"), "utf8");
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
  BAKE = mkdtempSync(join(tmpdir(), "vd-92r3-bake-"));
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
  const dir = mkdtempSync(join(tmpdir(), "vd-92r3-"));
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
const SF_NOW = JSON.stringify({ jobs: [{ id: "icims:jobs.statefarm.com:1", title: "Claim Specialist", company: "State Farm" }], total: 104, companiesResolved: [{ asked: "State Farm", name: "State Farm", tokens: ["jobs.statefarm.com"] }] });
const SF_OLD = JSON.stringify({ jobs: [], total: 0, unknownCompanies: ["State Farm"], companiesUnresolved: [{ asked: "State Farm", candidates: [{ token: "jobs.statefarm.com", name: "State Farm", open: 104, vendor: "icims", agency: true }], held: "agency" }] });
const PRICING_OLD = `<html><head><title>Pricing — Free Scan, $5 Full Resume Analysis or Pro $45/month</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","offers":{"@type":"AggregateOffer","priceCurrency":"USD","lowPrice":"0","highPrice":"45","offerCount":3}}</script></head><body><p>The Full Resume Analysis is a one-time payment that never renews.</p>${pad}</body></html>`;
const PRICING_OPEN = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","offers":{"@type":"AggregateOffer","priceCurrency":"USD","lowPrice":"0","highPrice":"45","offerCount":3}}</script></head><body><p>The Full Resume Analysis is a one-time payment that never renews.</p>${pad}</body></html>`;
const LLMS_OLD = `${pad}\nOne paid report (the $5 Full Analysis) and one optional monthly plan, Pro. Current prices are on [/pricing](https://resumebooster.work/pricing).\n`;

function healthy(over: Partial<Record<"build" | "sf" | "cc" | "pricing" | "llms", string>> = {}): Route[] {
  return [
    { match: `^OPTIONS ${FN}/layoff-filings$`, headers: over.build === "" ? {} : { "x-fn-build": over.build ?? "layoff-filings.2026-10-11.2" } },
    { match: `^POST ${FN}/job-board .*"companies":\\["State Farm"\\]`, body: over.sf ?? SF_NOW },
    { match: `^GET ${FN}/create-checkout$`, body: over.cc ?? JSON.stringify({ euSales: false, purchasesOpen: false }) },
    { match: "^GET https://site\\.test/pricing$", body: over.pricing ?? readFileSync(join(BAKE, "dist", "pricing", "index.html"), "utf8") },
    { match: "^GET https://site\\.test/llms\\.txt$", body: over.llms ?? readFileSync(join(BAKE, "dist", "llms.txt"), "utf8") },
  ];
}

describe("section 92, recheck 3", () => {
  it("a healthy deploy, read from this checkout's own bake with purchases closed, prints no FAIL, and only reads", () => {
    const { lines, calls } = run(healthy());
    expect(fails(lines), show(lines)).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toHaveLength(4);
    expect(calls).toHaveLength(5);
    for (const c of calls) {
      if (c.startsWith("POST ")) expect(c, "a POST is a job-board list read on the probe budget").toMatch(/\/functions\/v1\/job-board \{"action":"list".*\[x-rb-budget: probe\]$/);
      else expect(c).toMatch(/^(OPTIONS|GET) /);
    }
  });

  it("the old layoff-filings build reads FAIL, and a missing header too", () => {
    expect(has(run(healthy({ build: "layoff-filings.2026-10-11.1" })).lines, "FAIL", /layoff-filings x-fn-build = layoff-filings\.2026-10-11\.1/)).toBe(true);
    expect(has(run(healthy({ build: "" })).lines, "FAIL", /layoff-filings preflight carries no x-fn-build/)).toBe(true);
  });

  it("State Farm held as an agency's board and named uncarried reads FAIL", () => {
    const { lines } = run(healthy({ sf: SF_OLD }));
    expect(has(lines, "FAIL", /companies:\["State Farm"\] serves 0 rows, and names State Farm in unknownCompanies/), show(lines)).toBe(true);
  });

  it("the old /pricing (an offer up to $45, no purchases-open-soon line) reads FAIL while purchases are closed, and so does the old llms.txt", () => {
    const { lines } = run(healthy({ pricing: PRICING_OLD, llms: LLMS_OLD }));
    expect(has(lines, "FAIL", /purchases are closed .* still offers a price in its structured data, but never says Purchases open soon/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /\/llms\.txt does not say Purchases open soon while purchases are closed/), show(lines)).toBe(true);
  });

  it("once purchases open, an offered price passes and a stale purchases-open-soon line in llms.txt fails", () => {
    const cc = JSON.stringify({ purchasesOpen: true });
    const { lines } = run(healthy({ cc, pricing: PRICING_OPEN }));
    expect(has(lines, "PASS", /purchases are open .* offers what is sold/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /\/llms\.txt says Purchases open soon while purchases are open/), show(lines)).toBe(true);
  });

  it("a create-checkout GET without purchasesOpen cannot be judged and reads FAIL", () => {
    expect(has(run(healthy({ cc: "{}" })).lines, "FAIL", /create-checkout GET carries no purchasesOpen/)).toBe(true);
  });
});
