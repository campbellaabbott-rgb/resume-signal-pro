// @vitest-environment node
/**
 * A VERIFIER RUN THAT COULD NOT FAIL, AND AN ALARM NOBODY WATCHED
 * (S12 sweep, tests-ci and ops: S12-163, S12-164, S12-165, S12-069).
 *
 * WHAT WAS WRONG.
 *   S12-163  scripts/verify-deploy.sh had no positive control: a run in which
 *            every request failed still printed 48 PASS lines, each true of an
 *            empty answer, and a gateway's HTML body crashed section 1's node
 *            script, so the section printed nothing and vanished from the run.
 *   S12-164  section 71's employer-name line read the newest row only, which
 *            the insert trigger names: a board with 278 rows still carrying the
 *            code name read PASS.
 *   S12-165  section 78 wrote its CI jobs file only when a run id was listed,
 *            so a failed `gh run list` left the previous run's file, and the
 *            section certified CI from it.
 *   S12-069  board-health fired at :00 and :30, GitHub's busiest minutes, and
 *            ran 3 of about 40 slots; nothing outside GitHub noticed.
 *
 * WHAT HOLDS NOW, each by running the shipped shell in bash against fakes
 * (curl, gh and node's fetch), never the network.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { tally } from "../../scripts/verify-deploy-tally.mjs";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const def = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`no ${what} in the verifier`); return m[0]; };
const BUILD_GE = def(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge");
const PROBE = def(/^probe\(\) \{[\s\S]*?esac; \}$/m, "probe");
/** A section of the main script: from its echo line up to the next section's echo line. */
function section(header: string): string {
  const open = new RegExp(`^echo "== ${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m").exec(SCRIPT);
  if (!open) throw new Error(`no section ${header} in the verifier`);
  const rest = SCRIPT.slice(open.index + 1);
  const next = /^echo "(?:== |done\.)/m.exec(rest);
  return SCRIPT.slice(open.index, next ? open.index + 1 + next.index : undefined);
}
const sectionFile = (n: string) => readFileSync(resolve(ROOT, "scripts/verify-deploy.d", n), "utf8");

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

type Route = { match: string; status?: number; headers?: Record<string, string>; body?: string };
interface Fx { J?: string; R?: Record<string, string>; curl?: Route[]; fetch?: Route[]; gh?: string; files?: Record<string, string> }

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);let method="GET",url="",D=null,o=null,w=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];if(x==="-X")method=a[++i];else if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];
else if(x==="-d"||x==="--data")data=a[++i];else if(["-H","-m","-A","--max-time","--retry"].includes(x))i++;else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+"\\n");
const routes=JSON.parse(fs.readFileSync(process.env.VD_ROUTES,"utf8"));
const r=routes.find((x)=>new RegExp(x.match).test(method+" "+url))||{status:404,body:""};
const st=r.status??200;const hdr="HTTP/2 "+st+"\\r\\n"+Object.entries(r.headers||{}).map(([k,v])=>k+": "+v+"\\r\\n").join("")+"\\r\\n";
let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
const body=r.body??"";if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)out+=body;
if(w)out+=w.replace("%{http_code}",String(st));process.stdout.write(out);
`;
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_FETCH,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);const b=init&&init.body?String(init.body):"";fs.appendFileSync(process.env.VD_CALLS,"fetch\\t"+u+"\\t"+b+"\\n");
const r=routes.find((x)=>new RegExp(x.match).test(u+" "+b));
return r?new Response(r.body??"",{status:r.status??200}):new Response("{}",{status:200});};
`;

/** Run `body` in bash: J and R answer from fixtures, curl and gh are fakes on PATH, node's fetch answers from routes. */
function run(body: string, fx: Fx = {}): { lines: string[]; calls: string[]; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "vd-w4b-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  writeFileSync(join(dir, "bin", "gh"), fx.gh ?? "#!/bin/sh\nexit 1\n");
  chmodSync(join(dir, "bin", "curl"), 0o755);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "routes.json"), JSON.stringify(fx.curl ?? []));
  writeFileSync(join(dir, "fetch.json"), JSON.stringify(fx.fetch ?? []));
  writeFileSync(join(dir, "j.txt"), fx.J ?? "{}");
  for (const [fn, b] of Object.entries(fx.R ?? {})) writeFileSync(join(dir, `r_${fn}.txt`), b);
  for (const [n, v] of Object.entries(fx.files ?? {})) writeFileSync(join(dir, n), v);
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u
K=pk_test; RB=""; B=https://p.supabase.co; SITE=https://site.test; UA=ua
J() { echo "J\t$1" >> "$VD_CALLS"; cat ${JSON.stringify(join(dir, "j.txt"))}; }
R() { echo "R\t$1" >> "$VD_CALLS"; cat ${JSON.stringify(dir)}/r_$1.txt 2>/dev/null || echo '{"code":"PGRST202"}'; }
${BUILD_GE}
${PROBE}
`;
  writeFileSync(join(dir, "run.sh"), prelude + body.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_ROUTES: join(dir, "routes.json"), VD_FETCH: join(dir, "fetch.json"), VD_CALLS: join(dir, "calls.log"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return { lines: out.split("\n").filter(Boolean), calls: readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean), dir };
}
const has = (lines: string[], status: "PASS" | "FAIL" | "INFO", re: RegExp) => lines.some((l) => l.startsWith(`${status}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const GATEWAY_502 = "<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center></body></html>";
const STATUS = JSON.stringify({ version: "2026-09-09.93", catalogSize: 21_000, orphanPruneBlocked: false });

describe("S12-163: the verifier has a positive control and a tally", () => {
  it("the positive control passes on production's own status and FAILs on a gateway page", () => {
    const S0 = section("0. positive control");
    expect(has(run(S0, { J: STATUS }).lines, "PASS", /positive control: job-board status answered JSON as itself \(version 2026-09-09\.93, 21000 boards\)/)).toBe(true);
    const bad = run(S0, { J: GATEWAY_502 }).lines;
    expect(has(bad, "FAIL", /positive control: job-board status did not answer as itself.*502 Bad Gateway/), show(bad)).toBe(true);
  });

  it("an HTML body no longer erases section 1: it is a FAIL that shows the body", () => {
    const lines = run(section("1. job-board bundle"), { J: GATEWAY_502 }).lines;
    expect(lines.filter((l) => /^(PASS|FAIL|INFO) {2}/.test(l)), "section 1 printed nothing").not.toEqual([]);
    expect(has(lines, "FAIL", /job-board status did not answer JSON: .*502 Bad Gateway/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("PASS")), show(lines)).toBe(false);
  });

  it("an error body passes nothing in sections 2 and 3", () => {
    for (const h of ["2. the Remote filter", "3. company counts"]) {
      const lines = run(section(h), { J: GATEWAY_502 }).lines;
      expect(lines.some((l) => l.startsWith("PASS")), `${h}${show(lines)}`).toBe(false);
      expect(lines.some((l) => l.startsWith("FAIL")), `${h}${show(lines)}`).toBe(true);
    }
    const ok = run(section("2. the Remote filter"), { J: JSON.stringify({ jobs: [{ title: "Remote analyst" }] }) }).lines;
    expect(has(ok, "PASS", /negated-remote titles under workMode=remote: 0 of 1 read/), show(ok)).toBe(true);
  });

  it("the tally voids every PASS when the control fails, and names a section that printed nothing or crashed", () => {
    const t = tally([
      "== 0. positive control: production answers as itself ==", "FAIL  positive control: job-board status did not answer as itself",
      "== 2. remote ==", "PASS  negated-remote titles: 0", "== 3. counts ==", "PASS  facet row", "== 4. empty ==",
      "== 5n/5q. agent-mcp ==", "TypeError: Cannot read properties of undefined (reading 'jobs')", "    at Object.<anonymous> ([eval]:1:40)", "done.",
    ]);
    expect(t.failed).toBe(true);
    expect(t.verdicts).toContain("FAIL  the positive control failed: production did not answer as itself, so the 2 PASS line(s) above prove nothing");
    expect(t.verdicts.some((l) => /^FAIL {2}section 4 printed no verdict/.test(l))).toBe(true);
    expect(t.verdicts.some((l) => /^FAIL {2}section 5n\/5q hit a script error \(2 line\(s\)\)/.test(l))).toBe(true);
  });

  it("positive control: a run whose control passed and whose every section said something is not failed by the tally", () => {
    const t = tally(["== 0. positive control ==", "PASS  positive control: ok", "== 1. a ==", "PASS  a", "== 7m. b ==", "INFO  only info", "done."]);
    expect(t.failed).toBe(false);
    expect(t.verdicts).toEqual(["INFO  section 7m printed only INFO: nothing in it could fail this run (7m. b)"]);
    expect(tally(["== 1. a ==", "PASS  a"]).verdicts[0]).toMatch(/^FAIL {2}no positive control ran/);
  });

  it("the shipped script pipes its run through the tally once, and its exit status says FAIL", () => {
    const wrapper = def(/^if \[ -z "\$\{VD_INNER:-\}" \]; then[\s\S]*?^fi$/m, "the tally wrapper");
    const dir = mkdtempSync(join(tmpdir(), "vd-w4b-wrap-"));
    dirs.push(dir);
    mkdirSync(join(dir, "scripts"));
    copyFileSync(resolve(ROOT, "scripts/verify-deploy-tally.mjs"), join(dir, "scripts", "verify-deploy-tally.mjs"));
    const script = (body: string) => `set -u\ncd "$(dirname "$0")/.."\n${wrapper}\n${body}\necho "done."\n`;
    const exec = (body: string) => {
      writeFileSync(join(dir, "scripts", "verify-deploy.sh"), script(body));
      try { return { code: 0, out: execFileSync("bash", ["scripts/verify-deploy.sh"], { cwd: dir, encoding: "utf8", env: { ...process.env, VD_INNER: "" } }) }; }
      catch (e) { const x = e as { status?: number; stdout?: string }; return { code: x.status ?? 1, out: String(x.stdout ?? "") }; }
    };
    const dead = exec(`echo "== 0. positive control =="\necho "FAIL  positive control: no answer"\necho "== 1. a =="\necho "PASS  a"`);
    expect(dead.code, dead.out).toBe(1);
    expect(dead.out).toMatch(/^== tally ==$/m);
    expect(dead.out).toMatch(/^FAIL {2}the positive control failed: .* the 1 PASS line\(s\) above prove nothing$/m);
    expect(dead.out.match(/^== tally ==$/gm), "the run was piped through the tally twice").toHaveLength(1);
    const live = exec(`echo "== 0. positive control =="\necho "PASS  positive control: ok"\necho "== 1. a =="\necho "PASS  a"`);
    expect(live.code, live.out).toBe(0);
    expect(live.out).toMatch(/^INFO {2}2 PASS, 0 FAIL, 0 INFO across 2 sections; positive control pass$/m);
  });
});

describe("S12-164: section 71 counts every row it reads of a board's name", () => {
  const S71 = sectionFile("71-wave3-job-board.sh");
  const board = (tok: string, names: string[], total = names.length): Route => ({
    match: `job-board.*"companies":\\["${tok.replace(/[~.]/g, (c) => `\\${c}`)}"\\]`,
    body: JSON.stringify({ total, jobs: names.map((company, i) => ({ id: `${tok}-${i}`, company, title: "Analyst" })) }),
  });
  const named = (want: string, n: number) => Array.from({ length: n }, () => want);

  it("a board whose newest row is named but whose older rows keep the code name is not a pass", () => {
    const { lines } = run(S71, { J: STATUS, fetch: [board("cc", ["Climate Corps", ...named("cc", 278)])] });
    expect(has(lines, "FAIL", /F1 cc: 278 of 279 rows read \(of 279\) not named Climate Corps \(e\.g\. "cc"\)/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /F1 cc/), show(lines)).toBe(false);
  });

  it("positive control: every row named, the whole board read, is a PASS; a partial read is only INFO", () => {
    const whole = run(S71, { J: STATUS, fetch: [board("cc", named("Climate Corps", 12))] }).lines;
    expect(has(whole, "PASS", /F1 cc: 0 of 12 rows read \(of 12\) not named Climate Corps/), show(whole)).toBe(true);
    const part = run(S71, { J: STATUS, fetch: [board("cc", named("Climate Corps", 200), 950)] }).lines;
    expect(has(part, "INFO", /F1 cc: 0 of 200 rows read \(of 950\) not named Climate Corps: the rest of the board was not read/), show(part)).toBe(true);
    const asked = run(S71, { J: STATUS, fetch: [board("cc", named("Climate Corps", 3))] }).calls.find((c) => /"companies":\["cc"\]/.test(c)) ?? "";
    expect(asked).toMatch(/"limit":200/);
  });
});

describe("S12-165: section 78 never judges CI from an earlier run's files", () => {
  const S78 = sectionFile("78-wave3-tests-ci.sh");
  const STALE_JOBS = JSON.stringify({ databaseId: 111, jobs: [{ name: "test", conclusion: "success", steps: [] }, { name: "deno-tests", conclusion: "success" }] });
  const GH_AUTH_ONLY = "#!/bin/sh\ncase \"$1 $2\" in \"auth status\") exit 0;; esac\nexit 1\n";

  it("with gh signed in but every list failing, a jobs file left by an earlier run is removed and judges nothing", () => {
    const { lines, dir } = run(S78, { J: STATUS, gh: GH_AUTH_ONLY, files: { "vd_78_ci_jobs.json": STALE_JOBS, "vd_78_dep.log": "old log" } });
    expect(lines.some((l) => /CI on main, latest run: job (test|deno-tests) success/.test(l)), show(lines)).toBe(false);
    expect(has(lines, "INFO", /the CI runs on main could not be listed, so no CI line is judged/), show(lines)).toBe(true);
    expect(() => readFileSync(join(dir, "vd_78_ci_jobs.json"), "utf8"), "the stale jobs file survived").toThrow();
  });

  it("jobs that belong to another run than the one listed judge nothing; the listed run's own jobs do", () => {
    const gh = (jobsId: number) => `#!/bin/sh
case "$1 $2" in
  "auth status") exit 0;;
  "run list") case "$*" in *ci.yml*) echo '[{"databaseId":222,"conclusion":"success","createdAt":"2026-10-12T00:00:00Z","headSha":"abc"}]';; *) echo '[]';; esac;;
  "run view") echo '{"databaseId":${jobsId},"jobs":[{"name":"test","conclusion":"success","steps":[]},{"name":"deno-tests","conclusion":"success"}]}';;
esac
exit 0
`;
    const other = run(S78, { J: STATUS, gh: gh(111) }).lines;
    expect(has(other, "INFO", /do not belong to the latest CI run on main \(222\)/), show(other)).toBe(true);
    expect(other.some((l) => /job test success/.test(l)), show(other)).toBe(false);
    const own = run(S78, { J: STATUS, gh: gh(222) }).lines;
    expect(has(own, "PASS", /CI on main, latest run: job test success/), show(own)).toBe(true);
  });
});

describe("section 92 (w4b ops) judges what it claims", () => {
  const S92 = sectionFile("92-w4b-ops-email-tests.sh");
  const pre = (b: (fn: string) => string): Route[] => ["scan-heartbeat", "check-alerts"].map((fn) => ({ match: `^OPTIONS https://p\\.supabase\\.co/functions/v1/${fn}$`, headers: { "x-fn-build": b(fn) } }));
  const refusal: Route = { match: "^GET https://p\\.supabase\\.co/rest/v1/rpc/cron_http_answers\\?", status: 401, body: JSON.stringify({ code: "42501" }) };
  const health = (minutesAgo: number | null, issues: string[] = []) => JSON.stringify([{ status: "healthy", scans_last_hour: 2, success_rate_last_hour: 100, last_heartbeat_status: "healthy", last_heartbeat_time: minutesAgo === null ? null : new Date(Date.now() - minutesAgo * 60_000).toISOString(), issues }]);

  it("positive control: the round's builds, the reader's refusal and a running heartbeat pass", () => {
    const { lines } = run(S92, { curl: [...pre((fn) => `${fn}.2026-10-11.28`), refusal], R: { get_scan_health_status: health(6) } });
    expect(has(lines, "PASS", /scan-heartbeat x-fn-build = scan-heartbeat\.2026-10-11\.28/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /check-alerts x-fn-build = check-alerts\.2026-10-11\.28/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /cron_http_answers as anon -> 42501/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /the heartbeat last ran 6 min ago/), show(lines)).toBe(true);
    expect(lines.some((l) => l.startsWith("FAIL")), show(lines)).toBe(false);
  });

  it("an older build, a stopped heartbeat and the old reader's wording each FAIL", () => {
    const { lines } = run(S92, {
      curl: [...pre((fn) => `${fn}.2026-10-09.71`), refusal],
      R: { get_scan_health_status: health(55, ["No successful scans in last hour"]) },
    });
    expect(has(lines, "FAIL", /scan-heartbeat x-fn-build = scan-heartbeat\.2026-10-09\.71 \(want scan-heartbeat\.2026-10-11\.28 or later/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /the heartbeat last ran 55 min ago/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /still speaks the old reader/), show(lines)).toBe(true);
  });
});

describe("S12-069: the board alarm runs off-peak and an outside check hears every run", () => {
  type Step = { name?: string; if?: string; env?: Record<string, string>; run?: string };
  const wf = parseDocument(readFileSync(resolve(ROOT, ".github/workflows/board-health.yml"), "utf8")).toJS() as { on: { schedule: Array<{ cron: string }> }; jobs: { probe: { steps: Step[] } } };
  const steps = wf.jobs.probe.steps;
  const ping = steps.find((s) => /outside check/i.test(s.name ?? ""));

  it("fires at minutes 17 and 47, never on the hour or the half hour", () => {
    const minute = wf.on.schedule[0].cron.split(" ")[0];
    expect(minute.split(",").map(Number)).toEqual([17, 47]);
  });

  it("the ping step runs on every outcome, before the alarm, and reads the secret, the verdict and the probe's outcome", () => {
    expect(ping, "no step pings the outside check").toBeTruthy();
    expect(ping!.if).toBe("always()");
    expect(steps.indexOf(ping!)).toBeLessThan(steps.findIndex((s) => /alarm/i.test(s.name ?? "")));
    expect(ping!.env).toEqual({ PING_URL: "${{ secrets.BOARD_HEALTH_PING_URL }}", FAILED: "${{ steps.probe.outputs.failed }}", PROBE_OUTCOME: "${{ steps.probe.outcome }}" });
  });

  const exec = (env: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "bh-ping-"));
    dirs.push(dir);
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "curl"), `#!/bin/sh\nfor a in "$@"; do case "$a" in https://*) echo "$a" >> "${join(dir, "pinged")}";; esac; done\nexit 0\n`);
    chmodSync(join(dir, "bin", "curl"), 0o755);
    const out = execFileSync("bash", ["-c", ping!.run!], { encoding: "utf8", env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, ...env } });
    let pinged: string[] = [];
    try { pinged = readFileSync(join(dir, "pinged"), "utf8").split("\n").filter(Boolean); } catch { /* none */ }
    return { out, pinged };
  };

  it("a healthy run pings the check; a failing probe, or a probe that broke, pings /fail", () => {
    expect(exec({ PING_URL: "https://hc-ping.com/board-uuid/", FAILED: "", PROBE_OUTCOME: "success" }).pinged).toEqual(["https://hc-ping.com/board-uuid"]);
    expect(exec({ PING_URL: "https://hc-ping.com/board-uuid", FAILED: "probe", PROBE_OUTCOME: "success" }).pinged).toEqual(["https://hc-ping.com/board-uuid/fail"]);
    expect(exec({ PING_URL: "https://hc-ping.com/board-uuid", FAILED: "", PROBE_OUTCOME: "failure" }).pinged).toEqual(["https://hc-ping.com/board-uuid/fail"]);
  });

  it("without the secret it says so and sends nothing", () => {
    const r = exec({ PING_URL: "", FAILED: "", PROBE_OUTCOME: "success" });
    expect(r.pinged).toEqual([]);
    expect(r.out).toMatch(/BOARD_HEALTH_PING_URL is not set/);
  });
});
