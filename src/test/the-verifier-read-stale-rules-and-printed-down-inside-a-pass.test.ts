// @vitest-environment node
/**
 * THE VERIFIER READ STALE RULES, AND PRINTED "DOWN" INSIDE A PASS.
 *
 * The post-deploy triage of 2026-11-04 found verifier lines that judged a rule
 * the code had moved past, or could not fail on what they were read for:
 *   61 (c)  cursorStep still wanted to = from + started, which S8-087 ended on
 *           .92: a dormant skip passed puts the step above started;
 *   78      board-health had a 90-minute bar, and GitHub delivers about five
 *           runs a day: the bar failed on a healthy schedule;
 *   5t, 77  the H-1B lines compared the resident load to the raw bundle, not
 *           to what the refusals keep, and blamed the wrong gate for a cell
 *           the owner's load has yet to remove;
 *   63, 92  the heartbeat's liveness PASS printed "status down", and nothing
 *           looked at the fallback, which logs completed;
 *   62      fb_has wrote a broken pipe to stderr every time grep stopped early;
 *   7c      the funnel line compared opt-in counts to a baseline of all traffic
 *           and could not fail; its first rewrite passed on rows from before the
 *           consent step, so it now reads only the days since that step.
 * Each check runs the shipped shell in bash against fakes (curl, gh and node's
 * fetch), never the network.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { decodeLcaCells, refuseLcaCells, twinVendorTokens } from "../../supabase/functions/layoff-filings/lca-cells";
import { JOB_SOURCES } from "../../supabase/functions/layoff-filings/board-sources";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(__dirname, "../..");
const SCRIPT = readFileSync(resolve(ROOT, "scripts/verify-deploy.sh"), "utf8");
const def = (re: RegExp, what: string) => { const m = re.exec(SCRIPT); if (!m) throw new Error(`no ${what} in the verifier`); return m[0]; };
const BUILD_GE = def(/^build_ge\(\) \{[\s\S]*?^\}$/m, "build_ge");
const PROBE = def(/^probe\(\) \{[\s\S]*?esac; \}$/m, "probe");
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

type Route = { match: string; status?: number; body?: string };
interface Fx { J?: string; R?: Record<string, string>; fetch?: Route[]; gh?: string }

const FAKE_CURL = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);let D=null,o=null,w=null;
for(let i=0;i<a.length;i++){const x=a[i];if(x==="-D")D=a[++i];else if(x==="-o")o=a[++i];else if(x==="-w")w=a[++i];else if(["-X","-d","--data","-H","-m","-A","--max-time","--retry"].includes(x))i++;}
const hdr="HTTP/2 404\\r\\n\\r\\n";let out="";if(D==="-")out+=hdr;else if(D)fs.writeFileSync(D,hdr);
if(o&&o!=="/dev/null")fs.writeFileSync(o,"");if(w)out+=w.replace("%{http_code}","404");process.stdout.write(out);
`;
const FETCH_STUB = `const fs=require("fs");
const routes=JSON.parse(fs.readFileSync(process.env.VD_FETCH,"utf8"));
globalThis.fetch=async(url,init)=>{const u=String(url);const b=init&&init.body?String(init.body):"";
const r=routes.find((x)=>new RegExp(x.match).test(u+" "+b));
return r?new Response(r.body??"",{status:r.status??200}):new Response("{}",{status:200});};
`;

function run(body: string, fx: Fx = {}): string[] {
  const dir = mkdtempSync(join(tmpdir(), "vd-closeout-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "curl"), FAKE_CURL);
  writeFileSync(join(dir, "bin", "gh"), fx.gh ?? "#!/bin/sh\nexit 1\n");
  chmodSync(join(dir, "bin", "curl"), 0o755);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "fetch.cjs"), FETCH_STUB);
  writeFileSync(join(dir, "fetch.json"), JSON.stringify(fx.fetch ?? []));
  writeFileSync(join(dir, "j.txt"), fx.J ?? "{}");
  for (const [fn, b] of Object.entries(fx.R ?? {})) writeFileSync(join(dir, `r_${fn}.txt`), b);
  const prelude = `set -u
K=pk_test; RB=""; B=https://p.supabase.co; SITE=https://site.test; UA=ua
J() { cat ${JSON.stringify(join(dir, "j.txt"))}; }
R() { cat ${JSON.stringify(dir)}/r_$1.txt 2>/dev/null || echo '{"code":"PGRST202"}'; }
${BUILD_GE}
${PROBE}
`;
  writeFileSync(join(dir, "run.sh"), prelude + body.split("/tmp/").join(`${dir}/`));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    VD_FETCH: join(dir, "fetch.json"),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${join(dir, "fetch.cjs")}`.trim(),
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: ROOT, env, encoding: "utf8", timeout: 110_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  return out.split("\n").filter(Boolean);
}
type V = "PASS" | "FAIL" | "INFO";
const has = (lines: string[], v: V, re: RegExp) => lines.some((l) => l.startsWith(`${v}  `) && re.test(l));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;

describe("section 61 (c): the cursor step is judged by the rule since S8-087", () => {
  const step = (cs: Record<string, number>, coldBoards = 44403) =>
    run(sectionFile("61-wave2-job-board.sh"), { J: JSON.stringify({ version: "2026-09-09.100", coldBoards, sliceStats: { cursorStep: cs } }) });
  const verdict = (lines: string[]) => lines.find((l) => /\(c\) cursorStep/.test(l))?.slice(0, 4);

  it("a dormant skip passed puts the step above started, which the old rule called a FAIL", () => {
    const lines = step({ to: 16433, base: 80, from: 16376, started: 56, admitted: 16456 });
    expect(verdict(lines), show(lines)).toBe("PASS");
  });
  it("a deferral ahead of later starts puts it below; started equals the step; a wrap and the catalogue tail read true", () => {
    for (const cs of [{ from: 5402, admitted: 5482, to: 5444, base: 80, started: 51 }, { from: 1000, admitted: 1080, to: 1001, base: 80, started: 1 }, { from: 44390, admitted: 67, to: 7, base: 80, started: 20 }, { from: 44380, admitted: 0, to: 0, base: 23, started: 23 }]) {
      const lines = step(cs);
      expect(verdict(lines), `${JSON.stringify(cs)}${show(lines)}`).toBe("PASS");
    }
  });
  it("still FAILs a frozen cursor, the admission value left standing, a step past the slice, a wrong admission and a step backwards", () => {
    for (const cs of [{ from: 16376, admitted: 16456, to: 16376, base: 80, started: 56 }, { from: 16376, admitted: 16456, to: 16456, base: 80, started: 56 }, { from: 1000, admitted: 1080, to: 1100, base: 80, started: 56 }, { from: 1000, admitted: 1056, to: 1056, base: 80, started: 56 }, { from: 1000, admitted: 1080, to: 990, base: 80, started: 20 }]) {
      const lines = step(cs);
      expect(verdict(lines), `${JSON.stringify(cs)}${show(lines)}`).toBe("FAIL");
    }
  });
  it("the openly accepted residuals: a step of 1 passes, and a slice that started all but eight of its base boards passes", () => {
    expect(verdict(step({ from: 1000, admitted: 1080, to: 1001, base: 80, started: 56 }))).toBe("PASS");
    expect(verdict(step({ from: 1000, admitted: 1080, to: 1080, base: 80, started: 72 }))).toBe("PASS");
  });
});

describe("section 78: board-health's schedule is judged against what GitHub delivers", () => {
  const gh = (rows: unknown[]) => `#!/usr/bin/env node
const a=process.argv.slice(2);if(a[0]==="auth")process.exit(0);
if(a[0]==="run"&&a[1]==="list"){const w=a[a.indexOf("--workflow")+1];const lim=Number(a[a.indexOf("--limit")+1]||20);
process.stdout.write(JSON.stringify(w==="board-health.yml"?${JSON.stringify(rows)}.slice(0,lim):[]));process.exit(0)}
process.exit(1);
`;
  const sched = (minAgo: number, conclusion = "success") => ({ event: "schedule", conclusion, createdAt: iso(minAgo * MIN), headBranch: "main" });
  const push = (minAgo: number) => ({ event: "push", conclusion: "success", createdAt: iso(minAgo * MIN), headBranch: "main" });
  // The workflow has no push trigger, so GitHub writes this row only when it could not read the file.
  const broke = (minAgo: number, headBranch = "main") => ({ event: "push", conclusion: "failure", createdAt: iso(minAgo * MIN), headBranch });
  const s78 = () => sectionFile("78-wave3-tests-ci.sh");
  /** The section reads the workflow's last change from git, so a case that turns on it says when. */
  const changed = (minAgo: number) => `git() { echo ${iso(minAgo * MIN)}; }\n${s78()}`;

  it("a run 230 minutes old is the schedule alive: GitHub delivers about five a day, so the old 90-minute bar failed a healthy schedule", () => {
    const lines = run(s78(), { gh: gh([sched(230), sched(500), sched(800)]) });
    expect(has(lines, "PASS", /board-health's schedule is alive.*230 min ago/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /board-health's schedule|board-health has no/), show(lines)).toBe(false);
  });
  it("25 hours without a scheduled run, an empty list, or pushes only are a FAIL", () => {
    const old = run(s78(), { gh: gh([sched(25 * 60)]) });
    expect(has(old, "FAIL", /board-health's schedule is alive.*1500 min ago/), show(old)).toBe(true);
    expect(has(run(s78(), { gh: gh([]) }), "FAIL", /board-health has no runs GitHub can list/)).toBe(true);
    const pushes = run(s78(), { gh: gh([push(5), push(50)]) });
    expect(has(pushes, "FAIL", /no scheduled run listed/), show(pushes)).toBe(true);
  });
  it("thirty newer pushes do not hide an older scheduled run: the list is long enough to find it", () => {
    const rows = [...Array.from({ length: 30 }, (_, i) => push(i + 1)), sched(200)];
    const lines = run(s78(), { gh: gh(rows) });
    expect(has(lines, "PASS", /board-health's schedule is alive.*200 min ago/), show(lines)).toBe(true);
  });
  it("a merge that stopped the file parsing FAILs at once: its failed push is newer than the last scheduled run, which alone reads alive for a day", () => {
    const lines = run(changed(120), { gh: gh([broke(5), broke(20), broke(50), sched(300), sched(600)]) });
    expect(has(lines, "FAIL", /board-health does not parse on main: a push run failed at .*newer than its latest scheduled run/), show(lines)).toBe(true);
    expect(has(lines, "PASS", /board-health's schedule is alive/), show(lines)).toBe(false);
    expect(has(lines, "INFO", /the file as last changed has not run yet/), show(lines)).toBe(true);
    const noneYet = run(changed(120), { gh: gh([broke(5), broke(20)]) });
    expect(has(noneYet, "FAIL", /board-health does not parse on main: a push run failed at/), show(noneYet)).toBe(true);
  });
  it("a failed push older than the last scheduled run is history: the file was read again after it", () => {
    const lines = run(changed(9000), { gh: gh([sched(230), broke(4000), broke(4100), sched(5000)]) });
    expect(has(lines, "PASS", /board-health's schedule is alive.*230 min ago/), show(lines)).toBe(true);
    expect(has(lines, "FAIL", /does not parse/), show(lines)).toBe(false);
  });
  it("a failed push on another branch says nothing about the file on main, and neither does one before the file's last change", () => {
    const branch = run(changed(9000), { gh: gh([broke(5, "claude/some-old-branch"), sched(230)]) });
    expect(has(branch, "FAIL", /does not parse/), show(branch)).toBe(false);
    expect(has(branch, "PASS", /board-health's schedule is alive.*230 min ago/), show(branch)).toBe(true);
    const fixedSince = run(changed(10), { gh: gh([broke(30), sched(230)]) });
    expect(has(fixedSince, "FAIL", /does not parse/), show(fixedSince)).toBe(false);
    expect(has(fixedSince, "INFO", /the file as last changed has not run yet/), show(fixedSince)).toBe(true);
  });
  it("a scheduled run newer than the file's last change prints no such INFO", () => {
    const lines = run(changed(9000), { gh: gh([sched(230)]) });
    expect(has(lines, "INFO", /the file as last changed has not run yet/), show(lines)).toBe(false);
  });
  it("the cadence is INFO naming S12-069, and says only the healthy path has run live", () => {
    const lines = run(s78(), { gh: gh([sched(230), sched(500), sched(800)]) });
    expect(has(lines, "INFO", /board-health cadence, last 7 days: 3 scheduled run\(s\) of the 336.*worst gap 300 min.*S12-069.*only the healthy path has run live/), show(lines)).toBe(true);
    expect(lines.join("\n")).not.toMatch(/the alarm works/);
  });
});

describe("sections 5t and 77: the H-1B cells answer to what the refusals keep", () => {
  const PAYLOAD = readFileSync(resolve(ROOT, "supabase/functions/layoff-filings/lca-payload.ts"), "utf8");
  const pay = (n: string) => /^export const .* = "?([^";]*)"?;/m.exec(PAYLOAD.split("\n").find((l) => l.startsWith(`export const ${n} = `)) ?? "")?.[1] ?? "";
  const state = (cells: number, tokens: number, filings: number) => JSON.stringify([{ ls_cells: cells, ls_tokens: tokens, ls_filings: filings, ls_periods: 1, ls_fiscal_quarter: pay("LCA_FISCAL_QUARTER"), ls_published_on: pay("LCA_PUBLISHED_ON"), ls_source_file: pay("LCA_SOURCE_FILE"), ls_coverage_from: pay("LCA_COVERAGE_FROM"), ls_coverage_to: pay("LCA_COVERAGE_TO") }]);
  const s5t = () => section("5t. the H-1B wage cells");

  it("a resident load equal to the raw bundle FAILs and names the owner's load; one equal to what the refusals keep PASSes", async () => {
    const rows = await decodeLcaCells();
    const r = refuseLcaCells(rows, twinVendorTokens(JOB_SOURCES));
    const kept = { cells: r.kept.length, tokens: new Set(r.kept.map((x) => x.company_token)).size, filings: r.kept.reduce((n, x) => n + x.filings_n, 0) };
    const raw = run(s5t(), { R: { get_lca_load_state: state(Number(pay("LCA_CELL_COUNT")), Number(pay("LCA_TOKEN_COUNT")), Number(pay("LCA_CELL_WRITES"))) } });
    for (const re of [new RegExp(`every cell the refusals keep landed: ${pay("LCA_CELL_COUNT")} resident, want ${kept.cells}.*lca_wages`), new RegExp(`every board token the refusals keep landed: ${pay("LCA_TOKEN_COUNT")} of ${kept.tokens}.*lca_wages`), new RegExp(`the filings behind them: ${pay("LCA_CELL_WRITES")} of ${kept.filings}.*lca_wages`)]) {
      expect(has(raw, "FAIL", re), `${re}${show(raw)}`).toBe(true);
    }
    const loaded = run(s5t(), { R: { get_lca_load_state: state(kept.cells, kept.tokens, kept.filings) } });
    expect(has(loaded, "PASS", new RegExp(`every cell the refusals keep landed: ${kept.cells} resident`)), show(loaded)).toBe(true);
    expect(has(loaded, "PASS", new RegExp(`every board token the refusals keep landed: ${kept.tokens} of`)), show(loaded)).toBe(true);
    expect(has(loaded, "PASS", new RegExp(`the filings behind them: ${kept.filings} of`)), show(loaded)).toBe(true);
    expect(has(loaded, "FAIL", /refusals keep|the filings behind/), show(loaded)).toBe(false);
  });

  const none = (t: string) => ({ ow_company_token: t, ow_soc_code: null, ow_employer_filings_n: null });
  const cell = (t: string) => ({ ow_company_token: t, ow_soc_code: "15-1252", ow_worksite_state: "TX", ow_wage_low: 1, ow_wage_high: 2, ow_employer_filings_n: 43 });
  const LEDGER = /rpc\/get_employer_lca_wages .*"sigmasoftware2"/.source;
  const lca = (t: string) => `rpc/get_employer_lca_wages .*"${t}"`;
  const us = (t: string, total: number) => ({ match: `job-board .*"country":"US","companies":\\["${t}"\\]`, body: JSON.stringify({ jobs: [], total }) });
  const any = (t: string, total: number) => ({ match: `job-board .*"action":"list","companies":\\["${t}"\\]`, body: JSON.stringify({ jobs: [], total }) });
  const REFUSED = ["sigmasoftware2", "socialfinance", "sunday", "echo"];
  const gate = (over: Partial<Record<string, unknown>> = {}) => [
    { match: lca("siei"), body: JSON.stringify([over.siei ?? none("siei")]) },
    { match: lca("generalmotors~wd5~Careers_GM"), body: JSON.stringify([over.gm ?? cell("generalmotors~wd5~Careers_GM")]) },
    us("siei", 0), any("siei", 4),
  ];
  const s77 = () => sectionFile("77-wave3-board-data-ingest.sh");

  it("a refused token still answering a cell FAILs and names the owner's load, whichever token it is", () => {
    const stale = run(s77(), { fetch: [{ match: LEDGER, body: JSON.stringify([none("sigmasoftware2"), cell("socialfinance"), none("sunday"), none("echo")]) }, ...gate()] });
    expect(has(stale, "FAIL", /refused token.*socialfinance.*POST \{action:"lca_wages"\}/), show(stale)).toBe(true);
    // A row whose own cell is gone but which still carries the employer's filings is the load not run yet.
    const counted = run(s77(), { fetch: [{ match: LEDGER, body: JSON.stringify([none("sigmasoftware2"), none("socialfinance"), none("sunday"), { ...none("echo"), ow_employer_filings_n: 3 }]) }, ...gate()] });
    expect(has(counted, "FAIL", /refused token.*echo/), show(counted)).toBe(true);
    const clean = run(s77(), { fetch: [{ match: LEDGER, body: JSON.stringify(REFUSED.map(none)) }, ...gate()] });
    expect(has(clean, "PASS", /the 4 refused tokens answer no cell and no employer count/), show(clean)).toBe(true);
    expect(has(clean, "FAIL", /refused token/), show(clean)).toBe(false);
  });
  it("the gate is read on a control board proven live to have no US posting; a lit cell there FAILs, and no live control is INFO", () => {
    const fetch = (over: Partial<Record<string, unknown>> = {}) => [{ match: LEDGER, body: JSON.stringify(REFUSED.map(none)) }, ...gate(over)];
    const good = run(s77(), { fetch: fetch() });
    expect(has(good, "PASS", /a board with no live US posting prints no H-1B wage cell \(siei.*20261009160300/), show(good)).toBe(true);
    const lit = run(s77(), { fetch: fetch({ siei: cell("siei") }) });
    expect(has(lit, "FAIL", /a board with no live US posting prints no H-1B wage cell \(siei/), show(lit)).toBe(true);
    // Every candidate now has a US posting, or nothing live: the premise is gone, and the gate is not judged.
    const noControl = run(s77(), { fetch: [{ match: LEDGER, body: JSON.stringify(REFUSED.map(none)) }, { match: lca("generalmotors~wd5~Careers_GM"), body: JSON.stringify([cell("generalmotors~wd5~Careers_GM")]) }, ...["siei", "crown-equipment", "RolandBerger", "techster", "rystad-energy"].map((t) => us(t, 5))] });
    expect(has(noControl, "INFO", /no candidate board.*gate is not judged/), show(noControl)).toBe(true);
  });
  it("with no helper to read the bundle, a null on the control board proves nothing: INFO, and a lit cell is still a FAIL", () => {
    const fetch = (over: Partial<Record<string, unknown>> = {}) => [{ match: LEDGER, body: JSON.stringify(REFUSED.map(none)) }, ...gate(over)];
    const noTsx = `npx() { return 1; }\n${s77()}`;
    const blind = run(noTsx, { fetch: fetch() });
    expect(has(blind, "INFO", /a board with no live US posting.*siei.*bundle cell not checked.*not judged/), show(blind)).toBe(true);
    expect(has(blind, "PASS", /a board with no live US posting/), show(blind)).toBe(false);
    const lit = run(noTsx, { fetch: fetch({ siei: cell("siei") }) });
    expect(has(lit, "FAIL", /a board with no live US posting prints no H-1B wage cell \(siei/), show(lit)).toBe(true);
  });
  it("a null from the reader is not vacuous: a board with US postings and a bundle cell must still answer one", () => {
    const fetch = [{ match: LEDGER, body: JSON.stringify(REFUSED.map(none)) }, ...gate({ gm: none("generalmotors~wd5~Careers_GM") })];
    const lines = run(s77(), { fetch });
    expect(has(lines, "FAIL", /generalmotors~wd5~Careers_GM.*answers no cell/), show(lines)).toBe(true);
  });
});

describe("sections 63 and 92: the heartbeat's liveness is one line, its verdict another", () => {
  const health = (o: Record<string, unknown> = {}) => JSON.stringify([{ status: "healthy", last_successful_scan: iso(MIN), scans_last_hour: 0, success_rate_last_hour: null, avg_latency_last_hour: null, last_heartbeat_status: "healthy", last_heartbeat_time: iso(4 * MIN), issues: [], ...o }]);
  const beat = (p50: number | null, total = 6) => JSON.stringify([{ total_scans: total, completed_scans: total, failed_scans: 0, validation_errors: 0, success_rate: total ? 100 : null, avg_duration_ms: p50, p50_duration_ms: p50, p95_duration_ms: p50 }]);
  const s63 = () => sectionFile("63-wave2-email-ops.sh");
  const s92 = () => sectionFile("92-w4b-ops-email-tests.sh");

  it("status down is a FAIL in both sections and no PASS line says down", () => {
    const fx = { R: { get_scan_health_status: health({ status: "degraded", last_heartbeat_status: "down", issues: ["Last heartbeat: down"] }), get_scan_success_rate: beat(1400) } };
    for (const lines of [run(s63(), fx), run(s92(), fx)]) {
      expect(has(lines, "FAIL", /last (heartbeat|run).*status down/i), show(lines)).toBe(true);
      expect(lines.filter((l) => l.startsWith("PASS") && /\bdown\b/.test(l) && /heartbeat|sentinel/.test(l)), show(lines)).toEqual([]);
    }
  });
  it("the fallback logs completed, so a heartbeat scan of 1.4 s at p50 is a FAIL naming the AI chain and the owner's step", () => {
    const lines = run(s92(), { R: { get_scan_health_status: health({ status: "degraded", last_heartbeat_status: "degraded", issues: ["Last heartbeat: degraded"] }), get_scan_success_rate: beat(1400) } });
    expect(has(lines, "FAIL", /heartbeat scans took 1\.4 s at p50.*AI model chain.*\/scan-metrics.*credit/), show(lines)).toBe(true);
  });
  it("a p50 near the per-attempt timeout cannot tell a slow model from a chain that timed out and fell back: INFO, never a PASS", () => {
    const lines = run(s92(), { R: { get_scan_health_status: health(), get_scan_success_rate: beat(58000) } });
    expect(has(lines, "INFO", /heartbeat scans took 58\.0 s at p50.*timed out/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("PASS") && /heartbeat scans/.test(l)), show(lines)).toEqual([]);
    expect(lines.join("\n")).not.toMatch(/model answered/);
  });
  it("a healthy reading never FAILs: degraded alone is INFO, and 26 s at p50 did not fail fast", () => {
    const lines = run(s92(), { R: { get_scan_health_status: health({ status: "degraded", last_heartbeat_status: "degraded", issues: ["Last heartbeat: degraded"] }), get_scan_success_rate: beat(26839) } });
    expect(has(lines, "PASS", /heartbeat scans took 26\.8 s at p50.*did not fail fast/), show(lines)).toBe(true);
    expect(lines.join("\n")).not.toMatch(/model answered/);
    expect(lines.filter((l) => l.startsWith("FAIL") && /heartbeat scans|the heartbeat|AI model|status down/.test(l)), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /get_scan_health_status: status degraded/), show(lines)).toBe(true);
  });
  it("a mixed hour is INFO, no scans is INFO, and a reader that does not answer is INFO: none of them is judged", () => {
    const mixed = run(s92(), { R: { get_scan_health_status: health(), get_scan_success_rate: beat(9000) } });
    expect(has(mixed, "INFO", /heartbeat scans took 9\.0 s at p50.*mixed/), show(mixed)).toBe(true);
    const zero = run(s92(), { R: { get_scan_health_status: health(), get_scan_success_rate: beat(null, 0) } });
    expect(has(zero, "INFO", /no heartbeat scan in the last hour/), show(zero)).toBe(true);
    const gone = run(s92(), { R: { get_scan_health_status: health() } });
    expect(has(gone, "INFO", /get_scan_success_rate.*unreadable/), show(gone)).toBe(true);
  });
  it("a stopped heartbeat stays a FAIL in both sections", () => {
    const fx = { R: { get_scan_health_status: health({ last_heartbeat_time: iso(90 * MIN) }), get_scan_success_rate: beat(26000) } };
    expect(has(run(s63(), fx), "FAIL", /the sentinel ran 90 min ago/)).toBe(true);
    expect(has(run(s92(), fx), "FAIL", /the heartbeat last ran 90 min ago/)).toBe(true);
  });
});

describe("section 62: fb_has writes nothing to stderr when grep stops early", () => {
  it("a long body with an early match leaves no broken pipe, and the match still answers", () => {
    const def62 = /^\s*fb_has\(\) \{.*\}$/m.exec(sectionFile("62-wave2-frontend-board.sh"))?.[0] ?? "";
    expect(def62).not.toBe("");
    const body = `trap '' PIPE\n${def62}\nBIG=$'needle\\n'"$(head -c 2000000 /dev/zero | tr '\\0' x)"\nfb_has "$BIG" needle && echo found\nfb_has "$BIG" absent || echo missing\n`;
    const r = spawnSync("bash", ["-c", body], { encoding: "utf8" });
    expect(r.stdout.trim().split("\n")).toEqual(["found", "missing"]);
    expect(r.stderr, r.stderr).not.toMatch(/write error|Broken pipe/i);
  });
});

describe("section 7c: the funnel is read for what it counts now", () => {
  const stage = (n: number, later = 0) => JSON.stringify([{ landing_view: n, upload_started: later, scan_started: 0, results_viewed: 0, product_clicked: 0, checkout_started: 0, purchase_completed: 0 }]);
  const DAYS_SINCE_STEP = Math.floor((Date.now() - Date.parse("2026-11-02T00:00:00Z")) / 864e5);
  /** A reader that holds rows only older than the step: a window reaching past it finds them, and one that stays inside it finds none. */
  const onlyBeforeStep = `R() { D=$(printf '%s' "$2" | sed -E 's/.*"p_days_back":([0-9]+).*/\\1/'); if [ "$D" -gt ${DAYS_SINCE_STEP} ]; then echo '${stage(112, 1)}'; else echo '${stage(0)}'; fi; }\n`;

  it("rows from before the consent step prove nothing: a dead writer with an old week behind it does not PASS", () => {
    const lines = run(onlyBeforeStep + section("7c. "));
    expect(lines.filter((l) => l.startsWith("PASS")), show(lines)).toEqual([]);
    expect(has(lines, "INFO", /0 landing_view since 2026-11-02.*cannot separate a dead writer from no one opting in/), show(lines)).toBe(true);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });
  it("zero or a low count is INFO, because a live writer gives zero in a week about one time in six, and a real proof is a consenting visit", () => {
    for (const n of [0, 1, 2]) {
      const lines = run(section("7c. "), { R: { get_funnel_cohort_stats: stage(n) } });
      expect(has(lines, "INFO", new RegExp(`${n} landing_view since 2026-11-02.*cannot separate a dead writer from no one opting in.*consenting test visit.*owner`)), show(lines)).toBe(true);
      expect(lines.filter((l) => l.startsWith("PASS") || l.startsWith("FAIL")), show(lines)).toEqual([]);
    }
  });
  it("several rows since the step PASS, naming the window; a reader error stays a FAIL", () => {
    const alive = run(section("7c. "), { R: { get_funnel_cohort_stats: stage(115) } });
    expect(has(alive, "PASS", /funnel.*115 landing_view since 2026-11-02/), show(alive)).toBe(true);
    expect(has(run(section("7c. "), { R: { get_funnel_cohort_stats: '{"code":"42501"}' } }), "FAIL", /cohort reader/)).toBe(true);
  });
  it("the claim that later stages record has its own line: PASS when one is above zero, INFO when none is, and landing views cannot carry it", () => {
    const none = run(section("7c. "), { R: { get_funnel_cohort_stats: stage(115) } });
    expect(has(none, "INFO", /no later funnel stage.*since 2026-11-02/), show(none)).toBe(true);
    expect(has(none, "PASS", /later funnel stage/), show(none)).toBe(false);
    const some = run(section("7c. "), { R: { get_funnel_cohort_stats: stage(1, 2) } });
    expect(has(some, "PASS", /a later funnel stage records since 2026-11-02.*upload_started.*2/), show(some)).toBe(true);
  });
  it("says it counts only people who opted in, and no longer compares to a baseline of all traffic", () => {
    const lines = run(section("7c. "), { R: { get_funnel_cohort_stats: stage(115) } });
    expect(has(lines, "INFO", /opted in/), show(lines)).toBe(true);
    expect(lines.join("\n")).not.toMatch(/136,048 ?\/30d|judge this a day after deploy/);
  });
});

describe("section 89: a line that could never judge is gone", () => {
  it("does not read the verification stamps, which answer 401 to the anon key", () => {
    expect(sectionFile("89-job-board-ingest.sh")).not.toMatch(/rest\/v1\/job_board_verifications/);
  });
});
