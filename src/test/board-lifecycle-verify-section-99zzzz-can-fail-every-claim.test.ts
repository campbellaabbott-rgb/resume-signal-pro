// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * VERIFY SECTION 99zzzz (BOARD STREAM, LIFECYCLE) CAN FAIL EVERY CLAIM IT MAKES.
 *
 * scripts/verify-deploy.d/99zzzz-board-lifecycle.sh is the post-deploy proof
 * of job-board .100's lifecycle fixes: a lapped board's closures read
 * superseded from the whole lap (L1), the description sweep pages on a
 * first_seen|id keyset and says so in status (L2), and exists agrees with what
 * the list serves (L3). A PASS is worth something only if a regression could
 * have turned it into a FAIL (verify-deploy.d/README.md), so the section runs
 * here against a fake curl that answers from routes and logs every call.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 300_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-board-lifecycle.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const J_HELPER = /^J\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_99zzzz_bl";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,data=null,G=false;const hs=[],du=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-G")G=true;
  else if(x==="-d"||x==="--data")data=a[++i];else if(x==="--data-urlencode")du.push(a[++i]);else if(x==="-H")hs.push(a[++i]);else if(["-m","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
if(G&&du.length)url+="?"+du.join("&");
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\theaders:"+hs.join("|")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?"\\t"+data:"");
const r=routes.find((x)=>new RegExp(x.match).test(key))||{status:404,body:""};
const hdr="HTTP/2 "+(r.status??200)+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd99zzzzbl-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  writeFileSync(join(dir, "nofetch.cjs"), 'globalThis.fetch = async () => { throw new Error("no network in this test"); };\n');
  writeFileSync(join(dir, "run.sh"), `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${J_HELPER}\n${SECTION.split("/tmp/").join(`${dir}/`)}`);
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

const H = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const FB = "https://p\\.supabase\\.co/functions/v1/job-board";
const TOKENS = ["oreillyauto~wd1~oreilly", "cvshealth~wd1~CVS_Health_Careers", "ejwl~us2~CX", "dollartree~wd5~dollartreeus", "dominos"];
const SERVED = ["greenhouse:gusto:1", "greenhouse:gusto:2", "greenhouse:gusto:3"];
type Over = {
  build?: string | null; sliceBuild?: string; sinceH?: number; superseded?: number[];
  ds?: Record<string, unknown> | null; served?: string[]; open?: Record<string, boolean> | null; rowTest?: unknown;
};
function routes(o: Over = {}): Route[] {
  const build = o.build === undefined ? "job-board.2026-09-09.100" : o.build;
  const sup = o.superseded ?? [0, 3, 0, 0, 41];
  const served = o.served ?? SERVED;
  const open = o.open === undefined ? Object.fromEntries([...served.map((id) => [id, true]), ["greenhouse:gusto:0000000000", false]]) : o.open;
  const ds = o.ds === undefined ? { vendor: "oracle", doneAt: null, cursor: "2026-10-30T11:35:13.958123+00:00|oracle:ejwl~us2~CX:300012", floor: null, ageMin: 1 } : o.ds;
  return [
    { match: `^OPTIONS ${FB}$`, headers: build ? { "x-fn-build": build } : {} },
    { match: `^POST ${FB}\t.*"action":"status"`, body: JSON.stringify({ sliceStats: { build: o.sliceBuild ?? "2026-09-09.100", buildSince: iso((o.sinceH ?? 80) * H) }, ...(ds === null ? {} : { descSweep: ds }) }) },
    { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/get_company_hiring_health\\?", body: JSON.stringify(TOKENS.map((t, i) => ({ company_token: t, closed_90d: 1_000 + i, superseded_90d: sup[i] }))) },
    { match: `^POST ${FB}\t.*"action":"list"`, body: JSON.stringify({ jobs: served.map((id) => ({ id })) }) },
    { match: `^POST ${FB}\t.*"action":"exists"`, body: JSON.stringify(open === null ? { error: "boom" } : { open, ...("rowTest" in o ? (o.rowTest === undefined ? {} : { rowTest: o.rowTest }) : { rowTest: "served" }) }) },
  ];
}
const verdict = (lines: string[], tag: string) => {
  const hit = lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO)  ${tag} `).test(l));
  expect(hit, `${tag}: ${lines.join("\n")}`).toHaveLength(1);
  return hit[0].slice(0, 4);
};

describe("section 99zzzz passes a good deploy and fails each claim when it is false", () => {
  it("a good deploy: the preflight and every claim PASS; nothing FAILs", () => {
    const { lines } = run(routes());
    expect(lines.some((l) => l.startsWith("FAIL")), lines.join("\n")).toBe(false);
    expect(lines.filter((l) => l.startsWith("PASS")).length).toBe(4);
    for (const t of ["L1", "L2", "L3"]) expect(verdict(lines, t)).toBe("PASS");
  });

  it("before .100 serves: one INFO and no board read", () => {
    const { lines, calls } = run(routes({ build: "job-board.2026-09-09.96" }));
    expect(lines.filter((l) => !l.startsWith("==")).every((l) => l.startsWith("INFO")), lines.join("\n")).toBe(true);
    expect(calls.filter((c) => !c.includes("OPTIONS"))).toEqual([]);
  });

  it("no preflight build is a FAIL", () => {
    expect(run(routes({ build: null })).lines.some((l) => /^FAIL  job-board preflight/.test(l))).toBe(true);
  });

  it("L1: every lapped board still at 0 superseded 72 h after .100 is a FAIL, and INFO before", () => {
    expect(verdict(run(routes({ superseded: [0, 0, 0, 0, 0], sinceH: 80 })).lines, "L1")).toBe("FAIL");
    expect(verdict(run(routes({ superseded: [0, 0, 0, 0, 0], sinceH: 10 })).lines, "L1")).toBe("INFO");
  });

  it("L2: missing keys, or a bare first_seen cursor written after the window, are FAILs; a null cursor is INFO", () => {
    expect(verdict(run(routes({ ds: { vendor: "oracle", doneAt: null, ageMin: 1 } })).lines, "L2")).toBe("FAIL");
    expect(verdict(run(routes({ ds: null })).lines, "L2")).toBe("FAIL");
    expect(verdict(run(routes({ ds: { vendor: "oracle", doneAt: null, cursor: "2026-10-30T11:35:13.958123+00:00", floor: null, ageMin: 1 } })).lines, "L2")).toBe("FAIL");
    expect(verdict(run(routes({ ds: { vendor: "oracle", doneAt: null, cursor: null, floor: null, ageMin: 1 } })).lines, "L2")).toBe("INFO");
    // A bare cursor written before .100 had served 10 minutes is the one hop in flight across the deploy.
    expect(verdict(run(routes({ sinceH: 0.1, ds: { vendor: "oracle", doneAt: null, cursor: "2026-10-30T11:35:13.958123+00:00", floor: null, ageMin: 1 } })).lines, "L2")).toBe("INFO");
  });

  it("L3: a served row exists calls closed, an id no board holds read open, or no open map, are FAILs; nothing served is INFO", () => {
    expect(verdict(run(routes({ open: { [SERVED[0]]: true, [SERVED[1]]: false, [SERVED[2]]: true, "greenhouse:gusto:0000000000": false } })).lines, "L3")).toBe("FAIL");
    expect(verdict(run(routes({ open: { ...Object.fromEntries(SERVED.map((id) => [id, true])), "greenhouse:gusto:0000000000": true } })).lines, "L3")).toBe("FAIL");
    expect(verdict(run(routes({ open: null })).lines, "L3")).toBe("FAIL");
    expect(verdict(run(routes({ served: [] })).lines, "L3")).toBe("INFO");
  });

  it("L3: an exists answer that does not name the served row test is .96's, whatever its open map says: a FAIL", () => {
    // On a small whole-read board every served row is open under .96 too, so the map alone cannot tell the builds apart.
    expect(verdict(run(routes({ rowTest: undefined })).lines, "L3")).toBe("FAIL");
    expect(run(routes({ rowTest: undefined })).lines.find((l) => /^FAIL  L3 /.test(l))).toMatch(/rowTest/);
    expect(verdict(run(routes({ rowTest: "row" })).lines, "L3")).toBe("FAIL");
    expect(verdict(run(routes({ rowTest: undefined, served: [] })).lines, "L3")).toBe("FAIL");
  });

  it("never prints the key; every board call is a probe-budget status, list or exists read; the RPC is a GET", () => {
    const { out, calls } = run(routes());
    expect(out).not.toContain(KEY);
    const board = calls.filter((c) => /functions\/v1\/job-board/.test(c) && !c.includes("OPTIONS"));
    expect(board.length).toBe(3);
    for (const c of board) {
      expect(c, c).toMatch(/x-rb-budget: probe/);
      expect(c, c).toMatch(/"action":"(status|list|exists)"/);
    }
    const rpc = calls.filter((c) => c.includes("/rest/v1/"));
    expect(rpc.length).toBe(1);
    expect(rpc[0]).toMatch(/^curl\tGET /);
  });
});
