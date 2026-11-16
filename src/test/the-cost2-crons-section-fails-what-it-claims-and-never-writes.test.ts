// @vitest-environment node
//
// Node, not jsdom: this file runs the verifier section in bash, with a fake
// curl on PATH, through child_process.
/**
 * THE COST WAVE 2 CRON SECTION FAILS WHAT IT CLAIMS, AND NEVER WRITES.
 *
 * scripts/verify-deploy.d/99zzzzzz-cost2-crons.sh runs against a fake curl
 * that answers get_cron_health from a list and logs every call:
 *   - before the deploy (both dashboard-made jobs listed, no size stamp) every
 *     line is INFO and none is a FAIL;
 *   - a good deploy PASSes the three claims, whether or not the nightly job
 *     has run yet;
 *   - each broken claim is a FAIL: an old job still listed once the stamp job
 *     shows or COST2_APPLIED_AT is set, the stamp job on another schedule,
 *     without its timeout, paused, failing, missing after the files applied,
 *     or silent for more than a day after them, and every unreadable answer;
 *   - its one call is the read RPC, and the publishable key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzz-cost2-crons.sh"), "utf8");
/** The verifier's own read-RPC helper, so the section is run with what it runs with. */
const R_FN = /^R\(\) \{[^\n]*\}$/m.exec(SCRIPT)?.[0] ?? "";
const KEY = "pk_test_SECRET_marker_cost2";

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);
let method="GET",url="",o=null,data=null;
for(let i=0;i<a.length;i++){const x=a[i];
  if(x==="-X")method=a[++i];else if(x==="-o")o=a[++i];
  else if(x==="-d"||x==="--data"||x==="--data-binary")data=a[++i];else if(["-H","-m","-A","--max-time","-w","-D"].includes(x))i++;
  else if(/^https?:/.test(x))url=x;}
if(data!==null&&method==="GET")method="POST";
fs.appendFileSync(process.env.VD_CALLS,"curl\\t"+method+" "+url+(data!==null?"\\t"+data:"")+"\\n");
const body=fs.readFileSync(process.env.VD_BODY,"utf8");
if(o&&o!=="/dev/null")fs.writeFileSync(o,body);else if(!o)process.stdout.write(body);
`;

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } } });

function run(body: string, appliedAt?: string): { lines: string[]; calls: string[]; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "vdc2-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  writeFileSync(join(dir, "body.json"), body);
  writeFileSync(join(dir, "calls.log"), "");
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co; SITE=https://site.test; UA=ua\n${R_FN}\n`;
  writeFileSync(join(dir, "run.sh"), prelude + SECTION.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_BODY: join(dir, "body.json"), VD_CALLS: join(dir, "calls.log"),
  };
  delete env.COST2_APPLIED_AT;
  if (appliedAt !== undefined) env.COST2_APPLIED_AT = appliedAt;
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines: out.split("\n").filter((l) => /^(PASS|FAIL|INFO)/.test(l)), calls, out };
}

type Cron = {
  ch_jobname: string; ch_schedule: string; ch_active: boolean; ch_timeout: string | null; ch_runs: number;
  ch_failed: number; ch_timeouts: number; ch_last_start: string | null; ch_last_status: string | null;
  ch_last_seconds: number | null; ch_max_seconds: number | null;
};
const job = (name: string, schedule: string, timeout: string | null, runs: number, extra: Partial<Cron> = {}): Cron => ({
  ch_jobname: name, ch_schedule: schedule, ch_active: true, ch_timeout: timeout, ch_runs: runs, ch_failed: 0,
  ch_timeouts: 0, ch_last_start: runs ? new Date(Date.now() - 3600e3).toISOString() : null,
  ch_last_status: runs ? "succeeded" : null, ch_last_seconds: runs ? 0.4 : null, ch_max_seconds: runs ? 0.6 : null, ...extra,
});
/** Production's neighbours, as get_cron_health listed them on 2026-11-16. */
const OTHERS = [job("refresh-stats-cache", "27 * * * *", "10min", 24), job("scan-heartbeat-sentinel", "*/10 * * * *", null, 144)];
const WARM = job("warm-up-edge-functions", "*/10 * * * *", null, 144);
const PROBE = job("scheduled-health-probe-every-5min", "*/5 * * * *", null, 288);
const STAMP = (extra: Partial<Cron> = {}, runs = 1) => job("storage-size-stamp", "11 11 * * *", "60s", runs, extra);
const BEFORE = [...OTHERS, WARM, PROBE];
const AFTER = (stamp: Cron = STAMP()) => [...OTHERS, stamp];
const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const fails = (lines: string[]) => lines.filter((l) => l.startsWith("FAIL"));
const has = (lines: string[], kind: string, re: RegExp) => lines.some((l) => l.startsWith(kind) && re.test(l));
const failsWith = (body: Cron[] | string, re: RegExp, appliedAt?: string) => {
  const { lines, out } = run(typeof body === "string" ? body : JSON.stringify(body), appliedAt);
  expect(fails(lines).some((l) => re.test(l)), out).toBe(true);
};

describe("before the deploy", () => {
  it("prints an INFO line for every claim and no FAIL or PASS", () => {
    const { lines, out } = run(JSON.stringify(BEFORE));
    expect(fails(lines), out).toEqual([]);
    expect(lines.filter((l) => l.startsWith("PASS")), out).toEqual([]);
    expect(has(lines, "INFO", /^INFO  before 20261115100000: warm-up-edge-functions runs \(\*\/10 \* \* \* \*/), out).toBe(true);
    expect(has(lines, "INFO", /^INFO  before 20261115100000: scheduled-health-probe-every-5min runs \(\*\/5 \* \* \* \*/), out).toBe(true);
    expect(has(lines, "INFO", /^INFO  before 20261115110000: storage-size-stamp is not scheduled/), out).toBe(true);
  });
});

describe("a good deploy", () => {
  it("passes all three claims once the stamp job has run", () => {
    const { lines, out } = run(JSON.stringify(AFTER()));
    expect(fails(lines), out).toEqual([]);
    expect(has(lines, "PASS", /^PASS  warm-up-edge-functions is no longer scheduled \(20261115100000\)/), out).toBe(true);
    expect(has(lines, "PASS", /^PASS  scheduled-health-probe-every-5min is no longer scheduled \(20261115100000\)/), out).toBe(true);
    expect(has(lines, "PASS", /^PASS  storage-size-stamp runs on 11 11 \* \* \* with timeout 60s \(20261115110000\); last run succeeded/), out).toBe(true);
  });

  it("passes before the first nightly run, with or without COST2_APPLIED_AT", () => {
    for (const appliedAt of [undefined, ago(2)]) {
      const { lines, out } = run(JSON.stringify(AFTER(STAMP({}, 0))), appliedAt);
      expect(fails(lines), out).toEqual([]);
      expect(has(lines, "PASS", /^PASS  storage-size-stamp runs on 11 11 \* \* \* .*no run in the last 24h yet/), out).toBe(true);
    }
  });
});

describe("every broken claim is a FAIL", () => {
  it("an old job still listed once the stamp job shows, or once COST2_APPLIED_AT is set", () => {
    failsWith([...AFTER(), WARM], /^FAIL  warm-up-edge-functions is still scheduled .* storage-size-stamp shows in cron health: 20261115100000 did not take/);
    failsWith([...AFTER(), PROBE], /^FAIL  scheduled-health-probe-every-5min is still scheduled/);
    failsWith(BEFORE, /^FAIL  warm-up-edge-functions is still scheduled .* COST2_APPLIED_AT says the files applied/, ago(2));
  });

  it("the stamp job missing after the files applied, on another schedule, without its timeout, or paused", () => {
    failsWith(OTHERS, /^FAIL  storage-size-stamp is not scheduled though COST2_APPLIED_AT says 20261115110000 applied/, ago(2));
    failsWith(AFTER(STAMP({ ch_schedule: "11 * * * *" })), /^FAIL  storage-size-stamp: 11 \* \* \* \*, timeout 60s/);
    failsWith(AFTER(STAMP({ ch_timeout: null })), /^FAIL  storage-size-stamp: 11 11 \* \* \*, timeout none/);
    failsWith(AFTER(STAMP({ ch_active: false })), /^FAIL  storage-size-stamp: 11 11 \* \* \* PAUSED/);
  });

  it("a failing stamp run, and a stamp job silent for more than a day after the files applied", () => {
    failsWith(AFTER(STAMP({ ch_failed: 1, ch_last_status: "failed" })), /^FAIL  storage-size-stamp failed 1 of 1 runs in 24h \(last failed\)/);
    failsWith(AFTER(STAMP({}, 0)), /^FAIL  storage-size-stamp has not run in the last 24h though COST2_APPLIED_AT is more than 25 hours ago/, ago(30));
  });

  it("every unreadable answer", () => {
    failsWith("<html>gateway timeout</html>", /^FAIL  get_cron_health answered no JSON/);
    failsWith(JSON.stringify({ code: "PGRST202", message: "not found" }), /^FAIL  get_cron_health answered \{"code":"PGRST202"/);
    failsWith("[]", /^FAIL  get_cron_health answered no jobs at all/);
  });
});

describe("it only reads", () => {
  it("makes one call, the read RPC, and never prints the key", () => {
    const { calls, out } = run(JSON.stringify(AFTER()));
    expect(calls).toEqual([`curl\tPOST https://p.supabase.co/rest/v1/rpc/get_cron_health\t{"p_hours":24}`]);
    expect(out).not.toContain(KEY);
  });
});
