// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE HELD BOARD SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzz-audit-rest-held-board.sh).
 *
 * The section runs against a fake curl that answers from routes and logs every
 * call:
 *   - a good deploy prints no FAIL;
 *   - the build live before this round (job-board .100, the older agent-mcp and
 *     public-api, no cron) fails every claim the section makes;
 *   - each claim fails alone when only its own fix is missing;
 *   - a status that only ever answers from its memo is INFO, not a guess;
 *   - every POST is job-board with the probe header or an anon aggregate, and
 *     the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzz-audit-rest-held-board.sh"), "utf8");
const BUILD_GE = /^build_ge\(\) \{[\s\S]*?^\}$/m.exec(SCRIPT)?.[0] ?? "";
const R_FN = /^R\(\) \{.*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_held";

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string; bodies?: string[] };

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",D=null,o=null,w=null,data=null;const hs=[];
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(x==="-H")hs.push(a[++i]);else if(["-m","-A","--max-time"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\t"+(hs.some((h)=>/^x-rb-budget: probe$/i.test(h))?"probe":"noprobe")+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const key=method+" "+url+(data!==null?" "+data:"");
const idx=routes.findIndex((x)=>new RegExp(x.match).test(key));const r=idx>=0?routes[idx]:{status:404,body:""};
const seenFile=process.env.VD_CALLS+".seen."+idx;let seen=0;try{seen=Number(fs.readFileSync(seenFile,"utf8"))}catch{}
fs.writeFileSync(seenFile,String(seen+1));
const st=r.status??200;
const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.bodies?r.bodies[Math.min(seen,r.bodies.length-1)]:(r.body??"");if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.split("\\\\n").join("\\n").replace("%{http_code}",String(st));
process.stdout.write(out);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(routes: Route[]): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdheld-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "bin", "sleep"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(dir, "bin", "sleep"), 0o755);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(routes));
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${BUILD_GE}\n${R_FN}\n`;
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

const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const FN = (fn: string) => `https://p\\.supabase\\.co/functions/v1/${fn}`;
const preflight = (fn: string, build: string | null): Route => ({ match: `^OPTIONS ${FN(fn)}$`, headers: build ? { "x-fn-build": build } : {} });
const JOBS = Array.from({ length: 25 }, (_, i) => ({ source: i % 2 ? "greenhouse" : "lever" }));
const list = (o: Record<string, unknown>): Route => ({ match: `^POST ${FN("job-board")} .*"sendableOnly":true`, body: JSON.stringify(o) });
const upkeep = (status: number, error: string): Route => ({ match: `^POST ${FN("job-board")} .*"upkeep"`, status, body: JSON.stringify({ error }) });
const status = (o: Record<string, unknown>, headers: Record<string, string> = {}): Route => ({ match: `^POST ${FN("job-board")} .*"status"`, headers, body: JSON.stringify({ catalogSize: 800_000, ...o }) });
const hourly = (a: number, b: number): Route => ({
  match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_board_anon_hourly",
  bodies: [a, b].map((n) => JSON.stringify([{ bh_hour: "h", bh_kind: "probe", bh_country: "ALL", bh_requests: n }, { bh_hour: "h", bh_kind: "probe", bh_country: "US", bh_requests: 999 }])),
});
const cron = (rows: unknown): Route => ({ match: "^POST https://p\\.supabase\\.co/rest/v1/rpc/get_cron_health", body: JSON.stringify(rows) });
const JOB = { ch_jobname: "job-board-upkeep", ch_schedule: "2-59/5 * * * *", ch_active: true };
const LONG_SERVED = () => new Date(Date.now() - 60 * 60_000).toISOString();
const GOOD_STATUS = () => ({
  chainWatchdog: { decision: "within_window", kicked: false, readOnly: true },
  boardUpkeep: { at: "x", watchdog: "within_window", kicked: false, coverageStored: true, ageMin: 3 },
  sliceStats: { build: "2026-09-09.101", buildSince: LONG_SERVED() },
});
const builds = (): Route[] => [preflight("job-board", "job-board.2026-09-09.101"), preflight("agent-mcp", "agent-mcp.2026-11-03.1"), preflight("public-api", "public-api.2026-11-03.1")];
const good = (): Route[] => [
  ...builds(),
  list({ jobs: JOBS, ignoredFilters: ["sendableOnly"] }),
  upkeep(403, "upkeep is the scheduler's action"),
  status(GOOD_STATUS()),
  hourly(10, 11),
  cron([JOB]),
];
/** A route replaced by its matcher: the rest of a good deploy stays. */
const goodWith = (...over: Route[]): Route[] => [...over, ...good()];

describe("the held board section", () => {
  it("a good deploy passes every claim and fails none", () => {
    const { lines, out } = run(good());
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")).length, out).toBe(9);
  });

  it("a later build passes", () => {
    const { lines, out } = run(goodWith(preflight("job-board", "job-board.2026-09-09.140"), preflight("agent-mcp", "agent-mcp.2026-11-20.2")));
    expect(fails(lines), out).toEqual([]);
  });

  it("the build live before this round fails every claim", () => {
    const { lines, out } = run([
      preflight("job-board", "job-board.2026-09-09.100"), preflight("agent-mcp", "agent-mcp.2026-11-02.1"), preflight("public-api", "public-api.2026-11-02.1"),
      list({ jobs: JOBS.map(() => ({ source: "breezy" })) }),
      upkeep(400, "Unknown action"),
      status({ chainWatchdog: { decision: "within_window", kicked: false }, sliceStats: { build: "2026-09-09.100", buildSince: LONG_SERVED() } }),
      hourly(10, 10),
      cron([{ ch_jobname: "job-board-refresh", ch_active: true }]),
    ]);
    const F = fails(lines);
    for (const claim of [
      /job-board x-fn-build = job-board\.2026-09-09\.100, older/, /agent-mcp x-fn-build .* older/, /public-api x-fn-build .* older/,
      /retired flag has it named/, /0 of 25 rows/, /upkeep answered 400/, /readOnly/, /probe count grew by 0/, /no cron job is named job-board-upkeep/, /status publishes no boardUpkeep/,
    ]) expect(F.some((l) => claim.test(l)), `${claim}\n${out}`).toBe(true);
    expect(F, out).toHaveLength(10);
  });

  it("a build with no header fails", () => {
    const { lines } = run(goodWith(preflight("public-api", null)));
    expect(fails(lines)).toEqual([expect.stringMatching(/^FAIL {2}public-api preflight carries no x-fn-build/)]);
  });

  it("a flag still narrowing fails, and too few rows to judge is INFO", () => {
    const narrowed = run(goodWith(list({ jobs: JOBS.map(() => ({ source: "personio" })), ignoredFilters: ["sendableOnly"] })));
    expect(fails(narrowed.lines)).toEqual([expect.stringMatching(/0 of 25 rows/)]);
    const few = run(goodWith(list({ jobs: JOBS.slice(0, 3), ignoredFilters: ["sendableOnly"] })));
    expect(fails(few.lines)).toEqual([]);
    expect(few.lines.some((l) => /^INFO .*only 3 rows/.test(l))).toBe(true);
  });

  it("an upkeep the publishable key can run fails", () => {
    const { lines } = run(goodWith({ match: `^POST ${FN("job-board")} .*"upkeep"`, body: JSON.stringify({ at: "x", kicked: true }) }));
    expect(fails(lines)).toEqual([expect.stringMatching(/a 200 means anyone can run it/)]);
  });

  it("a status that kicked for an anonymous caller fails", () => {
    const { lines } = run(goodWith(status({ ...GOOD_STATUS(), chainWatchdog: { decision: "rekick", kicked: true } })));
    expect(fails(lines)).toEqual([expect.stringMatching(/chainWatchdog readOnly/)]);
  });

  it("a status that was not counted fails, and only the ALL rows are added", () => {
    const { lines } = run(goodWith(hourly(10, 10)));
    expect(fails(lines)).toEqual([expect.stringMatching(/probe count grew by 0/)]);
  });

  it("a count that grew passes nothing, because other probes grow the same counter on the build before this round too", () => {
    const { lines, out } = run(goodWith(hourly(10, 25)));
    expect(lines.some((l) => /^PASS .*probe count/.test(l)), out).toBe(false);
    expect(lines.some((l) => /^INFO .*probe count grew by 15 .*shared with every other probe/.test(l)), out).toBe(true);
    expect(fails(lines)).toEqual([]);
  });

  it("the header no longer says every line fails on the build before this round", () => {
    const head = SECTION.split("\n").slice(0, 25).join("\n");
    expect(head).not.toMatch(/every one fails on the job-board \.100 build/);
    expect(head).toMatch(/each fails on the job-board \.100 build, S2 aside/);
  });

  it("a status answered only from its memo judges neither readOnly nor the count, and says so", () => {
    const { lines, calls, out } = run(goodWith(hourly(10, 10), status({ chainWatchdog: { decision: "within_window", kicked: false } }, { "x-status-age-ms": "1200" })));
    expect(lines.some((l) => /^INFO .*no status computed in six tries/.test(l)), out).toBe(true);
    expect(fails(lines).filter((l) => /readOnly|probe count/.test(l))).toEqual([]);
    expect(calls.filter((c) => c.includes('"action":"status"'))).toHaveLength(6);
  });

  it("a missing or stopped cron fails", () => {
    expect(fails(run(goodWith(cron([]))).lines), "an empty aggregate is INFO").toEqual([]);
    expect(fails(run(goodWith(cron([{ ...JOB, ch_active: false }]))).lines)).toEqual([expect.stringMatching(/job-board-upkeep is scheduled .* active false/)]);
    expect(fails(run(goodWith(cron([{ ch_jobname: "other", ch_active: true }]))).lines)).toEqual([expect.stringMatching(/no cron job is named job-board-upkeep/)]);
  });

  it("an upkeep job that stopped running fails only once the build has served fifteen minutes", () => {
    const stale = { ...GOOD_STATUS(), boardUpkeep: { ageMin: 40, watchdog: "within_window", kicked: false } };
    expect(fails(run(goodWith(status(stale))).lines)).toEqual([expect.stringMatching(/upkeep: it last ran 40 min ago/)]);
    const never = { ...GOOD_STATUS(), boardUpkeep: null };
    expect(fails(run(goodWith(status(never))).lines)).toEqual([expect.stringMatching(/upkeep: it has never run/)]);
    const young = { ...never, sliceStats: { build: "2026-09-09.101", buildSince: new Date(Date.now() - 5 * 60_000).toISOString() } };
    const { lines } = run(goodWith(status(young)));
    expect(fails(lines)).toEqual([]);
    expect(lines.some((l) => /^INFO .*has served under fifteen minutes/.test(l))).toBe(true);
  });

  it("only reads: the POSTs are job-board with the probe header and two anon aggregates, and the key is never printed", () => {
    const { calls, out } = run(good());
    const posts = calls.filter((c) => c.startsWith("curl\tPOST"));
    for (const c of posts) {
      const url = c.split("\t")[1].replace("POST ", "");
      if (url.endsWith("/functions/v1/job-board")) expect(c, c).toMatch(/\tprobe$/);
      else expect(url).toMatch(/\/rest\/v1\/rpc\/(get_board_anon_hourly|get_cron_health)$/);
    }
    expect(posts.some((c) => /"action":"(refresh|click|report)"/.test(c))).toBe(false);
    expect(out).not.toContain(KEY);
  });

  it("every line it prints starts PASS, FAIL or INFO, after its header", () => {
    const { out } = run(good());
    for (const l of out.split("\n").filter(Boolean)) expect(l, l).toMatch(/^(PASS|FAIL|INFO|== )/);
  });
});
