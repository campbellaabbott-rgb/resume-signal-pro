// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE DB-HEAVY COST SECTION FAILS WHAT IT CLAIMS, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-cost-db-heavy.sh is run against a fake
 * curl that answers from routes and logs every call:
 *   - before the deploy (no queue table, no new functions) it prints INFO for
 *     those and no FAIL;
 *   - a good deploy prints a PASS for the queue, the four refusals, the three
 *     /jobs readers and the vendor wall, and no FAIL;
 *   - a queue anon can read (rows or an empty 200), a new function anon can
 *     call, a reader out of order, over its cap, under its floor or not
 *     answering, and a wall that disagrees with the facets row each FAIL;
 *   - a refresh landing between the wall's two reads is INFO, not FAIL;
 *   - every request is a GET, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-cost-db-heavy.sh"), "utf8");
const PROBE = /^probe\(\) \{[\s\S]*?esac; \}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_db_heavy";

// `bodies`: the n-th matching call answers bodies[n] (the last one repeats).
type Route = { match: string; status?: number; body?: string; bodies?: string[] };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
const line=method+" "+url+(data!==null?" "+data:"");
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+line+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const idx=routes.findIndex((x)=>new RegExp(x.match).test(line));
const r=idx>=0?routes[idx]:{status:404,body:""};
let body=r.body??"";
if(r.bodies){const cf=process.env.VD_CALLS+".n";let n={};try{n=JSON.parse(fs.readFileSync(cf,"utf8"))}catch{}
  const k=String(idx);const c=n[k]||0;body=r.bodies[Math.min(c,r.bodies.length-1)];n[k]=c+1;fs.writeFileSync(cf,JSON.stringify(n));}
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st)).replace("%{time_total}","0.123");
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdch-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${PROBE}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

const REST = "https://p\\.supabase\\.co/rest/v1/";
const DENIED = JSON.stringify({ code: "42501", message: "permission denied" });
const NO_FN = JSON.stringify({ code: "PGRST202", message: "Could not find the function" });
const NO_TABLE = JSON.stringify({ code: "PGRST205", message: "Could not find the table" });
const NEW_FNS = ["employer_perk_extractor_version", "employer_perk_sweep_due", "refresh_jobs_live_aggregates"];

const COUNTRIES = [{ country: "US", n: 401_234 }, { country: "GB", n: 61_002 }, { country: "DE", n: 30_100 }, { country: "IE", n: 10 }];
const BENCH = [
  { category: "design", currency: "USD", n: 412, median_annual_min: 98_000 },
  { category: "engineering", currency: "USD", n: 9_120, median_annual_min: 142_500 },
  { category: null, currency: "EUR", n: 31, median_annual_min: 51_000 },
];
const AS_OF = "2026-11-09T14:22:05.120384+00:00";
const SOURCES = { greenhouse: 48_102, workday: 305_380, lever: 9_001 };
const WALL = { sourcesFacet: SOURCES, openTotal: 362_483, as_of: AS_OF, cached: true };
const FACETS = { total: 1_020_000, companiesFacet: [{ token: "acme", name: "Acme", count: 4 }], sourcesFacet: { workday: 305_380, lever: 9_001, greenhouse: 48_102 },
  openTotal: 362_483, as_of: AS_OF, cached: true, stale: false };

/** What one endpoint answers; routes() supplies where it is matched. */
type Answer = Omit<Route, "match">;
type World = {
  queue?: Answer; fns?: (fn: string) => Answer; country?: Answer; salary?: Answer; takedowns?: Answer; wall?: Answer; facets?: Answer;
};
const routes = (w: World = {}): Route[] => [
  { ...(w.queue ?? { status: 401, body: DENIED }), match: `^GET ${REST}job_board_embed_requeue\\?select=\\*&limit=1$` },
  { match: `^GET ${REST}rpc/get_embed_batch\\?p_limit=1$`, status: 401, body: DENIED },
  ...NEW_FNS.map((fn) => ({ ...(w.fns?.(fn) ?? { status: 401, body: DENIED }), match: `^GET ${REST}rpc/${fn}$` })),
  { ...(w.country ?? { body: JSON.stringify(COUNTRIES) }), match: `^GET ${REST}rpc/get_country_facet$` },
  { ...(w.salary ?? { body: JSON.stringify(BENCH) }), match: `^GET ${REST}rpc/get_salary_benchmarks$` },
  { ...(w.takedowns ?? { body: "8123" }), match: `^GET ${REST}rpc/get_takedowns_today$` },
  { ...(w.wall ?? { body: JSON.stringify(WALL) }), match: `^GET ${REST}rpc/get_board_vendor_counts$` },
  { ...(w.facets ?? { body: JSON.stringify(FACETS) }), match: `^GET ${REST}rpc/get_job_board_facets$` },
];
const BEFORE: World = { queue: { status: 404, body: NO_TABLE }, fns: () => ({ status: 404, body: NO_FN }) };
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const passes = (lines: string[]) => lines.filter((l) => l.startsWith("PASS"));

describe("section 99zzzzzz (cost audit, db-heavy)", () => {
  it("before the deploy it prints INFO for what is not there yet, and no FAIL", () => {
    const { lines, out } = run(routes(BEFORE));
    expect(fails(lines), out).toEqual([]);
    expect(lines.some((l) => /^INFO {2}E1 .*20261109150000 has not applied/.test(l)), out).toBe(true);
    for (const fn of NEW_FNS) expect(lines.some((l) => l.startsWith(`INFO  ${fn} -> PGRST202`)), `${fn}\n${out}`).toBe(true);
    expect(passes(lines).some((l) => /^PASS {2}get_embed_batch as anon -> 42501/.test(l)), out).toBe(true);
  });

  it("a good deploy PASSes the queue, the four refusals, the three readers and the wall, with no FAIL", () => {
    const { lines, out } = run(routes());
    expect(fails(lines), out).toEqual([]);
    const p = passes(lines);
    expect(p.some((l) => /^PASS {2}E1 job_board_embed_requeue SELECT as anon -> 401 42501/.test(l)), out).toBe(true);
    for (const fn of ["get_embed_batch", ...NEW_FNS]) expect(p.some((l) => l.startsWith(`PASS  ${fn} as anon -> 42501`)), `${fn}\n${out}`).toBe(true);
    expect(p.some((l) => /^PASS {2}L1 get_country_facet answers 4 countries, largest first \(US 401,234\)/.test(l)), out).toBe(true);
    expect(p.some((l) => /^PASS {2}L1 get_salary_benchmarks answers 3 categories/.test(l)), out).toBe(true);
    expect(p.some((l) => /^PASS {2}L1 get_takedowns_today answers a whole number: 8,123/.test(l)), out).toBe(true);
    expect(p.some((l) => /^PASS {2}V1 the vendor wall answers the facets row's own pass: 3 vendors, openTotal 362,483/.test(l)), out).toBe(true);
  });

  it("a queue the client roles can read FAILs, whether it shows rows or an empty answer", () => {
    for (const body of ["[]", JSON.stringify([{ id: "greenhouse:acme:1", queued_at: AS_OF }])]) {
      const { lines, out } = run(routes({ queue: { status: 200, body } }));
      expect(fails(lines).some((l) => /^FAIL {2}E1 job_board_embed_requeue answers anon 200/.test(l)), out).toBe(true);
    }
  });

  it("a new function anon can call FAILs", () => {
    const { lines, out } = run(routes({ fns: (fn) => (fn === "employer_perk_extractor_version" ? { body: "2" } : { status: 401, body: DENIED }) }));
    expect(fails(lines).some((l) => l.startsWith("FAIL  employer_perk_extractor_version as anon")), out).toBe(true);
  });

  it("a country picker out of order, over its cap, under its floor, or refused FAILs", () => {
    const cases: Array<[unknown, RegExp]> = [
      [[COUNTRIES[1], COUNTRIES[0]], /not largest first/],
      [Array.from({ length: 41 }, (_, i) => ({ country: `C${i}`, n: 1000 - i })), /41 countries/],
      [[...COUNTRIES, { country: "LU", n: 9 }], /at least 10 postings/],
      [[{ country: "", n: 50 }], /named country/],
      [[], /no country/],
    ];
    for (const [body, why] of cases) {
      const { lines, out } = run(routes({ country: { body: JSON.stringify(body) } }));
      expect(fails(lines).some((l) => l.startsWith("FAIL  L1 get_country_facet") && why.test(l)), out).toBe(true);
    }
    const { lines, out } = run(routes({ country: { status: 401, body: DENIED } }));
    expect(fails(lines).some((l) => /^FAIL {2}L1 get_country_facet as anon: HTTP 401/.test(l)), out).toBe(true);
  });

  it("benchmarks with a thin category, a repeated one, the unnamed one not last, or no median FAIL", () => {
    const cases: Array<[unknown, RegExp]> = [
      [[{ ...BENCH[0], n: 29 }], /30 postings/],
      [[BENCH[0], BENCH[0]], /listed twice/],
      [[BENCH[2], BENCH[0]], /unnamed category is not last/],
      [[{ ...BENCH[0], median_annual_min: null }], /a median/],
      [{ code: "57014", message: "canceling statement due to statement timeout" }, /not an array/],
    ];
    for (const [body, why] of cases) {
      const { lines, out } = run(routes({ salary: { body: JSON.stringify(body) } }));
      expect(fails(lines).some((l) => l.startsWith("FAIL  L1 get_salary_benchmarks") && why.test(l)), out).toBe(true);
    }
  });

  it("a takedown ticker that is not a whole number FAILs", () => {
    for (const body of ["null", "\"8\"", "-1", "<html>gateway</html>"]) {
      const { lines, out } = run(routes({ takedowns: { body } }));
      expect(fails(lines).some((l) => l.startsWith("FAIL  L1 get_takedowns_today")), `${body}\n${out}`).toBe(true);
    }
  });

  it("a wall that disagrees with the facets row it is cut from FAILs, naming what differs", () => {
    const cases: Array<[object, RegExp]> = [
      [{ ...WALL, openTotal: 1 }, /openTotal 1 vs 362483/],
      [{ ...WALL, sourcesFacet: { ...SOURCES, lever: 1 } }, /sourcesFacet differs/],
      [{ ...WALL, cached: false }, /cached false/],
      [{ ...WALL, sourcesFacet: {} }, /no vendor counted|sourcesFacet differs/],
    ];
    for (const [wall, why] of cases) {
      const { lines, out } = run(routes({ wall: { body: JSON.stringify(wall) } }));
      expect(fails(lines).some((l) => l.startsWith("FAIL  V1") && why.test(l)), out).toBe(true);
    }
    const stale = run(routes({ wall: { body: JSON.stringify({ ...WALL, as_of: "2026-11-09T13:52:01+00:00" }) } }));
    expect(fails(stale.lines).some((l) => /^FAIL {2}V1 .*as_of 2026-11-09T13:52:01/.test(l)), stale.out).toBe(true);
    const html = run(routes({ wall: { status: 502, body: "<html>bad gateway</html>" } }));
    expect(fails(html.lines).some((l) => /^FAIL {2}V1 get_board_vendor_counts as anon did not answer an object/.test(l)), html.out).toBe(true);
  });

  it("a refresh between the wall's two reads is INFO, not a FAIL", () => {
    const later = { ...WALL, as_of: "2026-11-09T14:37:04+00:00", openTotal: 362_900 };
    const { lines, out } = run(routes({ wall: { bodies: [JSON.stringify(WALL), JSON.stringify(later)] } }));
    expect(fails(lines), out).toEqual([]);
    expect(lines.some((l) => /^INFO {2}V1 a facets refresh landed mid-check/.test(l)), out).toBe(true);
  });

  it("every request is a GET, and the publishable key is never printed", () => {
    const worlds: World[] = [BEFORE, {}, { queue: { status: 200, body: "[]" } }];
    for (const w of worlds) {
      const { calls, out } = run(routes(w));
      expect(calls.length).toBeGreaterThan(10);
      expect(calls.filter((c) => !/^curl\tGET /.test(c)), "a section that writes nothing sends nothing but GETs").toEqual([]);
      expect(out).not.toContain(KEY);
    }
  });
});
