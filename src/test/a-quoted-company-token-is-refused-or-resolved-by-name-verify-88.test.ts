// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 88: A QUOTED COMPANY TOKEN IS REFUSED, OR RESOLVED BY NAME,
 * AND NEVER THE FILTER (job-board .98, fix/pd-job-board).
 *
 * The line was written for .88, which refused companies ["\"dominos\""] and
 * named it in ignoredFilters (defect-sweep 2.24: before .88 the quoted value
 * reached the filter and forged a filter-integrity incident). Since .93 a
 * company value that is not a token is resolved by name (company-names.ts):
 * live on .96 (2026-10-31) the read answers companiesResolved
 * [{asked:"\"dominos\"", name:"Domino's", tokens:["dominos"]}], serves only
 * Domino's rows and trips no incident, and the line printed FAIL
 * ("ignoredFilters = null"). The property is the same: the raw quoted value
 * is never the filter. So the line passes on either shape, and FAILs when
 * nothing is named (the 2.24 shape), when a resolved token is not
 * token-shaped, or when a row of any other token is served.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 300_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/88-job-board-abuse.sh"), "utf8");
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_88";
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","--max-time"].includes(x))i++;
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
if(w)out+=w.replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(section: string, quoted: unknown): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd88-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  const status = { version: "2026-09-09.98", demandLane: { perSlice: 1, perHour: 12, cooldownMin: 180, servedLastHour: 3, queued: 0, cooling: 0 }, filterContract: { incidents: {} } };
  const page = { jobs: Array.from({ length: 60 }, (_, i) => ({ id: `greenhouse:acme:${i}`, token: "acme" })) };
  const routes: Route[] = [
    { match: `^OPTIONS ${FB}$`, headers: { "x-fn-build": "job-board.2026-09-09.98" } },
    { match: `^POST ${FB}\\t\\{"action":"status"\\}$`, body: JSON.stringify(status) },
    { match: `^POST ${FB}\\t.*"companies":\\["\\\\"dominos\\\\""\\]`, body: JSON.stringify(quoted) },
    { match: `^POST ${FB}\\t.*"postedAfter"`, body: JSON.stringify({ jobs: [], ignoredFilters: ["postedAfter"] }) },
    { match: `^POST ${FB}\\t.*"searchQuality"`, status: 403, body: '{"error":"forbidden"}' },
    { match: `^POST ${FB}\\t.*"action":"list"`, body: JSON.stringify(page) },
  ];
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co\n${J_HELPER}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + section.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "nofetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), out };
}

const quotedLine = (lines: string[]) => lines.filter((l) => /a quoted company token/.test(l));
const RESOLVED = { asked: "\"dominos\"", name: "Domino's", tokens: ["dominos"] };
const dominos = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `smartrecruiters:dominos:${i}`, token: "dominos", company: "Domino's" }));

describe("section 88's quoted-token line judges the property, not the .88 spelling of it", () => {
  it("the .93 shape (resolved by name, only its rows served) PASSes, as live on .96", () => {
    const { lines, calls, out } = run(SECTION, { jobs: dominos(1), total: 10_000, companiesResolved: [RESOLVED] });
    expect(quotedLine(lines), lines.join("\n")).toHaveLength(1);
    expect(quotedLine(lines)[0]).toMatch(/^PASS {2}a quoted company token is refused and named, or resolved by name/);
    expect(lines.filter((l) => l.startsWith("FAIL")), lines.join("\n")).toEqual([]);
    expect(out, "the key is never printed").not.toContain(KEY);
    expect(calls.some((c) => c.includes('"companies":["\\"dominos\\""]')), "the quoted read was made").toBe(true);
    for (const c of calls.filter((x) => /"action":"list"/.test(x) && !/x-rb-budget: browser/.test(x))) expect(c).toContain("x-rb-budget: probe");
  });

  it("the .88 shape (refused and named) still PASSes", () => {
    const { lines } = run(SECTION, { jobs: [{ id: "greenhouse:acme:1", token: "acme" }], ignoredFilters: ["companies"] });
    expect(quotedLine(lines)[0]).toMatch(/^PASS /);
  });

  it("the 2.24 shape FAILs: nothing named, whether the quoted filter matched nothing or every row came back", () => {
    for (const body of [{ jobs: [], total: 0 }, { jobs: [{ id: "greenhouse:acme:1", token: "acme" }], total: 5 }, { jobs: dominos(1), companiesResolved: [] }]) {
      const { lines } = run(SECTION, body);
      expect(quotedLine(lines)[0], JSON.stringify(body)).toMatch(/^FAIL {2}a quoted company token/);
    }
  });

  it("FAILs when the resolution serves another employer's rows, or resolves to a value that is not a token", () => {
    const stray = run(SECTION, { jobs: [...dominos(1), { id: "greenhouse:pizzahut:1", token: "pizzahut" }], companiesResolved: [RESOLVED] });
    expect(quotedLine(stray.lines)[0]).toMatch(/^FAIL .*tokens served = \["dominos","pizzahut"\]/);
    const quote = run(SECTION, { jobs: [], companiesResolved: [{ ...RESOLVED, tokens: ["\"dominos\""] }] });
    expect(quotedLine(quote.lines)[0]).toMatch(/^FAIL /);
    const other = run(SECTION, { jobs: dominos(1), companiesResolved: [{ ...RESOLVED, asked: "dominos" }] });
    expect(quotedLine(other.lines)[0], "a resolution of some other ask is not this one").toMatch(/^FAIL /);
  });

  it("a budget refusal is INFO, not a verdict", () => {
    const { lines } = run(SECTION, { error: "board_budget", code: "anon_minute" });
    expect(lines.filter((l) => /quoted-token read refused 429/.test(l))[0]).toMatch(/^INFO /);
    expect(quotedLine(lines)).toEqual([]);
  });

  it("STALE BEFORE: the .88 line printed FAIL on the .93 shape live on .96", () => {
    const old = execFileSync("git", ["show", "f8d72a9b:scripts/verify-deploy.d/88-job-board-abuse.sh"], { cwd: ROOT, encoding: "utf8" });
    expect(old).toContain('q.ignoredFilters.includes("companies"),"a quoted company token is refused and named: ignoredFilters = "');
    const { lines } = run(old, { jobs: dominos(1), total: 10_000, companiesResolved: [RESOLVED] });
    expect(lines.filter((l) => /a quoted company token/.test(l))[0]).toBe("FAIL  a quoted company token is refused and named: ignoredFilters = null (want it to include companies)");
  });
});
