// @vitest-environment node
//
// Node, not jsdom: this file runs a verifier section in bash, in a throwaway
// git checkout, with a fake gh on PATH, through child_process.
/**
 * THE CI-TOOLING-B BUG-ROUND SECTION CAN FAIL WHAT IT CLAIMS, AND NEVER WRITES
 * (scripts/verify-deploy.d/99zzzzzzz-bugs-ci-tooling-b.sh).
 *
 * The section runs in a throwaway checkout: CI and the Deploy workflow as
 * this round left them, the post-publish smoke and its helpers, section 92,
 * a function whose build a later comment names, and a ledger that prints a
 * fixture (and lends the real ledger's buildOf). R answers get_cron_health
 * from a fixture and a fake gh answers run, file and annotation reads:
 *   - production before the merge (GitHub main without this round, the
 *     ledger as this branch prints it today) fails nothing;
 *   - after the merge every line passes, and each one FAILs when its claim is
 *     false: CI without the check, a red check on main, an anchor on the
 *     comment, a vault migration left as a Lovable step, a call ahead of its
 *     migration the ledger does not refuse, a smoke that passes what it
 *     skipped, a Deploy workflow that compares job-board alone or pushes
 *     migrations, a Deploy run that verified an older build or called a
 *     changed push empty, and a section 92 that passes on pg_cron's word;
 *   - the only reads are get_cron_health, the ledger and GitHub GETs; no
 *     request leaves through the smoke; the key is never printed.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const SECTION = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zzzzzzz-bugs-ci-tooling-b.sh"), "utf8");
const KEY = "pk_test_SECRET_marker_citooling_b";
const CLEAN: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !/^(GIT_|NO_SCAN$|NO_INDEXNOW$|INDEXNOW_SEND$|INDEXING_SEND$|HEARTBEAT_SECRET$|SYNTHETIC_SCAN_SECRET$|SITE$)/.test(k)));
const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const real = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const CI = real(".github/workflows/ci.yml");
const DEPLOY = real(".github/workflows/deploy.yml");
const SMOKE = real("scripts/post-publish-smoke.mjs");
const S92 = real("scripts/verify-deploy.d/92-w4b-payments-delivery.sh");

// What the round replaced, rebuilt here as text (no test reads git history).
const CI_WITHOUT_CHECK = CI.replace("bash scripts/check-functions.sh --check-only", "echo nothing checked");
const DEPLOY_BEFORE = `name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      apply_migrations:
        description: x
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: |
          EXPECTED=$(grep -m1 -oE 'BUILD_VERSION = "[^"]+"' supabase/functions/job-board/index.ts)
  migrate:
    runs-on: ubuntu-latest
    steps:
      - run: supabase db push --project-ref p
`;
const SMOKE_PASSING_SKIPS = SMOKE.replace(/const skip = \(name, detail\) => \{[^]*?\n\};\n/, "const skip = (name, detail) => record(name, true, `SKIPPED ${detail}`);\n");
const S92_PASSING = S92.replace(/else console\.log\("INFO {2}pg_cron queued[^\n]*/, `else console.log("PASS  mail-watch ran "+runs+" times in 24 hours with no failed run");'`);

const VAULT = "20261201100000_a_cron_reads_its_key.sql";
const PLAIN = "20261201110000_a_table.sql";

type Checkout = { dir: string; A: string; B: string; C: string };
/** A: x and y stamped. B: x's code moves and a comment names its build (the old anchor). C: y bumped (the Deploy run's push). */
function checkout(o: { ci?: string; deploy?: string; smoke?: string; s92?: string } = {}): Checkout {
  const dir = mkdtempSync(join(tmpdir(), "vdbctb-"));
  dirs.push(dir);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: CLEAN, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (p: string, body: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); };
  const cp = (p: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); copyFileSync(resolve(ROOT, p), join(dir, p)); };
  const commit = (m: string) => { g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", m); return g("rev-parse", "HEAD"); };
  g("init", "-q", "-b", "main");
  put(".github/workflows/ci.yml", o.ci ?? CI);
  put(".github/workflows/deploy.yml", o.deploy ?? DEPLOY);
  cp("scripts/check-functions.sh");
  put("scripts/post-publish-smoke.mjs", o.smoke ?? SMOKE);
  for (const p of ["scripts/indexnow-ping.mjs", "scripts/google-indexing-notify.mjs", "scripts/seo-previous-publish.mjs", ".env", "public/sitemap.xml",
    "supabase/functions/free-keyword-scan/index.ts", "supabase/functions/agent-mcp/oauth.ts", "supabase/functions/agent-mcp/as-probe.ts"]) cp(p);
  put("scripts/verify-deploy.d/92-w4b-payments-delivery.sh", o.s92 ?? S92);
  // The ledger prints the fixture and lends the real buildOf and buildAtLeast.
  put("scripts/deploy-ledger.mjs", `export { buildOf, buildAtLeast } from ${JSON.stringify(pathToFileURL(resolve(ROOT, "scripts/deploy-ledger.mjs")).href)};
import { appendFileSync, readFileSync } from "node:fs";
if (process.argv.includes("--json")) { appendFileSync(process.env.VD_CALLS, "ledger --json\\n"); process.stdout.write(readFileSync(process.env.VD_LEDGER, "utf8")); process.exitCode = Number(process.env.VD_LX || 0); }
`);
  put("docs/deploy-ledger.json", JSON.stringify({ verifiedDeploys: [] }));
  put(`supabase/migrations/${VAULT}`, "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'k';\n");
  put(`supabase/migrations/${PLAIN}`, "CREATE TABLE IF NOT EXISTS public.t (id int);\n");
  put("supabase/functions/x/index.ts", 'const FN_BUILD = "x.2026-11-01.1";\nconst cors = { "x-fn-build": FN_BUILD };\nexport const run = () => 1;\n');
  put("supabase/functions/y/index.ts", 'const FN_BUILD = "y.2026-11-02.1";\nconst cors = { "x-fn-build": FN_BUILD };\nexport { cors };\n');
  const A = commit("A");
  put("supabase/functions/x/index.ts", '// 2026-11-01.1 kept: a note that names the build\nconst FN_BUILD = "x.2026-11-01.1";\nconst cors = { "x-fn-build": FN_BUILD };\nexport const run = () => 2;\n');
  const B = commit("B");
  put("supabase/functions/y/index.ts", 'const FN_BUILD = "y.2026-11-17.1";\nconst cors = { "x-fn-build": FN_BUILD };\nexport { cors };\n');
  const C = commit("C");
  return { dir, A, B, C };
}

type Gh = {
  auth?: number;
  ciSha?: string; ciYml?: string; ciJobs?: unknown;
  deployMain?: string; depSha?: string; depYml?: string; verifyConclusion?: string; annotations?: unknown;
};
type Opts = { ledger?: unknown; lx?: number; cron?: unknown; gh?: Gh | null; co?: Checkout };

const FAKE_GH = `#!/usr/bin/env node
const fs=require("fs");const a=process.argv.slice(2);const D=process.env.GH_DIR;
fs.appendFileSync(process.env.VD_CALLS,"gh "+a.join(" ")+"\\n");
const f=(n)=>{try{return fs.readFileSync(D+"/"+n,"utf8")}catch{return null}};
const out=(n)=>{const t=f(n);if(t===null){process.stderr.write("Not Found");process.exit(1)}process.stdout.write(t);process.exit(0)};
if(a[0]==="auth")process.exit(Number(f("auth")||0));
if(a[0]==="run"&&a[1]==="list")out("runs-"+a[a.indexOf("--workflow")+1]+".json");
if(a[0]==="run"&&a[1]==="view")out("view-"+a[2]+".json");
if(a[0]==="api"){const p=a[1];
  let m=/contents\\/\\.github\\/workflows\\/([a-z]+)\\.yml\\?ref=(.+)$/.exec(p);if(m)out("file-"+m[1]+"-"+m[2]+".yml");
  m=/check-runs\\/(\\d+)\\/annotations$/.exec(p);if(m)out("ann-"+m[1]+".json");}
process.exit(1);
`;

function run(o: Opts = {}) {
  const co = o.co ?? checkout();
  const dir = mkdtempSync(join(tmpdir(), "vdbctb-run-"));
  dirs.push(dir);
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "gh"));
  writeFileSync(join(dir, "bin", "gh"), o.gh === null ? "#!/bin/sh\nexit 1\n" : FAKE_GH);
  chmodSync(join(dir, "bin", "gh"), 0o755);
  writeFileSync(join(dir, "bin", "curl"), `#!/bin/sh\necho "curl $*" >> "$VD_CALLS"\nexit 0\n`);
  chmodSync(join(dir, "bin", "curl"), 0o755);
  const gh = o.gh ?? {};
  const w = (n: string, body: unknown) => writeFileSync(join(dir, "gh", n), typeof body === "string" ? body : JSON.stringify(body));
  w("auth", String(gh.auth ?? 0));
  const ciSha = gh.ciSha ?? "c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1c1";
  w("runs-ci.yml.json", [{ databaseId: 501, headSha: ciSha, conclusion: "success", status: "completed" }]);
  w(`file-ci-${ciSha}.yml`, gh.ciYml ?? CI);
  w("view-501.json", gh.ciJobs ?? ciJobs("success"));
  w("file-deploy-main.yml", gh.deployMain ?? DEPLOY);
  const depSha = gh.depSha ?? co.C;
  w("runs-deploy.yml.json", [{ databaseId: 601, headSha: depSha, conclusion: gh.verifyConclusion ?? "success", status: "completed" }]);
  w(`file-deploy-${depSha}.yml`, gh.depYml ?? DEPLOY);
  w("view-601.json", { databaseId: 601, jobs: [{ name: "deploy", databaseId: 70, conclusion: "success" }, { name: "verify", databaseId: 71, conclusion: gh.verifyConclusion ?? "success" }] });
  w("ann-71.json", gh.annotations ?? [notice("Deploy verified", "1 function(s) this push changed serve this commit's builds or later: y.2026-11-17.1")]);
  writeFileSync(join(dir, "ledger.json"), typeof o.ledger === "string" ? o.ledger : JSON.stringify(o.ledger ?? ledger(co)));
  writeFileSync(join(dir, "cron.json"), JSON.stringify(o.cron ?? [MAIL_WATCH]));
  writeFileSync(join(dir, "calls.log"), "");
  const body = SECTION.split("/tmp/").join(`${dir}/`);
  const prelude = `set -u\nK=${KEY}; B=https://p.supabase.co\nR() { echo "R $*" >> "$VD_CALLS"; cat "${join(dir, "cron.json")}"; }\n`;
  writeFileSync(join(dir, "run.sh"), prelude + body);
  const env: NodeJS.ProcessEnv = {
    ...CLEAN,
    PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    HOME: join(dir, "home"),
    VD_CALLS: join(dir, "calls.log"), GH_DIR: join(dir, "gh"), VD_LEDGER: join(dir, "ledger.json"), VD_LX: String(o.lx ?? 6),
    NO_INDEXNOW: "1",
  };
  let out = "";
  try { out = execFileSync("bash", [join(dir, "run.sh")], { cwd: co.dir, env, encoding: "utf8", timeout: 55_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { out = String((e as { stdout?: string }).stdout ?? ""); }
  const lines = out.split("\n").filter(Boolean);
  const calls = readFileSync(join(dir, "calls.log"), "utf8").split("\n").filter(Boolean);
  return { lines, calls, out };
}
const notice = (title: string, message: string) => ({ annotation_level: "notice", title, message });
const failure = (title: string, message: string) => ({ annotation_level: "failure", title, message });
const ciJobs = (conclusion: string | null, stepName = "Edge-function type check (every index.ts and *_test.ts, deno check)") => ({ databaseId: 501, jobs: [
  { name: "deno-tests", databaseId: 8, status: "completed", conclusion, steps: conclusion === null ? [{ name: "Deno tests", conclusion: "success" }] : [{ name: stepName, conclusion }, { name: "Deno tests (supabase/functions/**/*_test.ts)", conclusion: "success" }] },
] });
const MAIL_WATCH = { ch_jobname: "mail-watch", ch_schedule: "*/15 * * * *", ch_active: true, ch_runs: 96, ch_failed: 0, ch_last_status: "succeeded" };
/** The ledger's JSON for the checkout: x anchored on A (its declaration), y on C; one vault file an owner step; one call ahead, unrecorded. */
function ledger(co: Checkout, o: Record<string, unknown> = {}) {
  return {
    head: co.C.slice(0, 8),
    rows: [
      { fn: "x", want: "x.2026-11-01.1", have: "x.2026-11-01.1", state: "live", stampCommit: co.A.slice(0, 8), changedSinceStamp: ["supabase/functions/x/index.ts"] },
      { fn: "y", want: "y.2026-11-17.1", have: "y.2026-11-02.1", state: "deploy", stampCommit: co.C.slice(0, 8), changedSinceStamp: [] },
    ],
    migrations: { pending: [PLAIN, VAULT], hold: [], neverApplyPresent: [] },
    phases: { pre: [{ file: PLAIN, note: "" }], afterFunctions: [], afterFrontend: [], errors: [] },
    ownerSteps: [{ file: VAULT, note: "", held: false }],
    aheadOfMigration: { calls: [{ fn: "y", object: "t_reader", files: [PLAIN], tolerated: null }], errors: ["y calls t_reader"] },
    ...o,
  };
}
const tag = (lines: string[], key: string) => lines.filter((l) => new RegExp(`^(PASS|FAIL|INFO) {2}${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} `).test(l));
const status = (lines: string[], key: string) => tag(lines, key).map((l) => l.slice(0, 4));
const show = (lines: string[]) => `\n${lines.join("\n")}`;
const KEYS = ["S14X-136a", "S14X-136b", "S14X-137", "RC-OI-47b", "NB-33", "S14X-138", "S14X-139a", "S14X-246", "S14X-139b", "RC-S13-108"];

describe("before the merge and after it", () => {
  it("before the merge (GitHub main without this round) nothing FAILs, and every GitHub line is INFO", () => {
    const co = checkout();
    const { lines } = run({ co, gh: { ciYml: CI_WITHOUT_CHECK, deployMain: DEPLOY_BEFORE, depYml: DEPLOY_BEFORE, verifyConclusion: "failure", annotations: [failure("Deployed code is not this commit", "job-board serves '2026-09-09.101' and this commit is '2026-09-09.102'")] } });
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
    for (const k of ["S14X-136b", "S14X-139a", "S14X-246", "S14X-139b"]) expect(status(lines, k), `${k}${show(lines)}`).toEqual(["INFO"]);
  });

  it("after the merge every line passes", () => {
    const { lines } = run();
    for (const k of KEYS) expect(status(lines, k), `${k}${show(lines)}`).toEqual(["PASS"]);
    expect(lines.filter((l) => l.startsWith("FAIL")), show(lines)).toEqual([]);
  });
});

describe("each line FAILs when its claim is false", () => {
  it("S14X-136a: a CI whose deno-tests job runs no type check", () => {
    const { lines } = run({ co: checkout({ ci: CI_WITHOUT_CHECK }) });
    expect(tag(lines, "S14X-136a"), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-136a .*runs no check-functions\.sh --check-only/)]);
  });

  it("S14X-136b: main's type check red, or a run that skipped it; an unfinished run is INFO", () => {
    expect(status(run({ gh: { ciJobs: ciJobs("failure") } }).lines, "S14X-136b")).toEqual(["FAIL"]);
    expect(status(run({ gh: { ciJobs: ciJobs(null) } }).lines, "S14X-136b")).toEqual(["FAIL"]);
    expect(status(run({ gh: { ciJobs: ciJobs("skipped") } }).lines, "S14X-136b")).toEqual(["INFO"]);
  });

  it("S14X-137: a ledger anchored on the comment that names the build", () => {
    const co = checkout();
    const { lines } = run({ co, ledger: ledger(co, { rows: [{ fn: "x", want: "x.2026-11-01.1", have: "x.2026-11-01.1", state: "live", stampCommit: co.B.slice(0, 8), changedSinceStamp: [] }] }) });
    expect(tag(lines, "S14X-137"), show(lines)).toEqual([expect.stringMatching(new RegExp(`^FAIL {2}S14X-137 .*x \\(ledger ${co.B.slice(0, 8)}, declaration ${co.A.slice(0, 8)}\\)`))]);
  });

  it("RC-OI-47b: no ownerSteps, a vault file that is not one, or one in a numbered Lovable step", () => {
    const co = checkout();
    const noKey: Record<string, unknown> = { ...ledger(co) };
    delete noKey.ownerSteps;
    expect(status(run({ co, ledger: noKey }).lines, "RC-OI-47b")).toEqual(["FAIL"]);
    expect(status(run({ co, ledger: ledger(co, { ownerSteps: [] }) }).lines, "RC-OI-47b")).toEqual(["FAIL"]);
    expect(status(run({ co, ledger: ledger(co, { phases: { pre: [{ file: PLAIN }, { file: VAULT }], afterFunctions: [], afterFrontend: [], errors: [] } }) }).lines, "RC-OI-47b")).toEqual(["FAIL"]);
  });

  it("NB-33: no aheadOfMigration, or an unrecorded call the ledger does not refuse; all recorded passes", () => {
    const co = checkout();
    const noKey: Record<string, unknown> = { ...ledger(co) };
    delete noKey.aheadOfMigration;
    expect(status(run({ co, ledger: noKey }).lines, "NB-33")).toEqual(["FAIL"]);
    expect(status(run({ co, lx: 4 }).lines, "NB-33")).toEqual(["FAIL"]);
    expect(status(run({ co, lx: 0, ledger: ledger(co, { aheadOfMigration: { calls: [{ fn: "y", object: "t_reader", files: [PLAIN], tolerated: "reads nothing while absent" }], errors: [] } }) }).lines, "NB-33")).toEqual(["PASS"]);
  });

  it("the ledger printing nothing is a FAIL for its three lines", () => {
    const { lines } = run({ ledger: "not json" });
    for (const k of ["S14X-137", "RC-OI-47b", "NB-33"]) expect(status(lines, k), k).toEqual(["FAIL"]);
  });

  it("S14X-138: a smoke that records what it skipped as a pass, and ends ALL CLEAR", () => {
    const { lines } = run({ co: checkout({ smoke: SMOKE_PASSING_SKIPS }) });
    expect(SMOKE_PASSING_SKIPS).not.toBe(SMOKE);
    expect(tag(lines, "S14X-138"), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-138 under NO_SCAN=1 the smoke a check it did not run printed PASS/)]);
  });

  it("S14X-139a and S14X-246: a checkout's Deploy workflow that compares job-board alone and pushes migrations (no gh)", () => {
    const { lines } = run({ co: checkout({ deploy: DEPLOY_BEFORE }), gh: null });
    expect(tag(lines, "S14X-139a"), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-139a this checkout \(no gh\): the verify job does not run the ledger/)]);
    expect(tag(lines, "S14X-246"), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}S14X-246 this checkout \(no gh\): 1 supabase db push step\(s\) and an apply_migrations input/)]);
    for (const k of ["S14X-136b", "S14X-139b"]) expect(status(lines, k), k).toEqual(["INFO"]);
  });

  it("S14X-139b: a green run that verified an older build than its commit, or called a push that changed y empty", () => {
    const older = run({ gh: { annotations: [notice("Deploy verified", "1 function(s) this push changed serve this commit's builds or later: y.2026-11-02.1")] } }).lines;
    expect(tag(older, "S14X-139b"), show(older)).toEqual([expect.stringMatching(/^FAIL {2}S14X-139b .*for builds older than its commit: y\.2026-11-02\.1 \(that commit is y\.2026-11-17\.1\)/)]);
    const empty = run({ gh: { annotations: [notice("No function changed", "this push changed no edge function, so no live build was compared")] } }).lines;
    expect(tag(empty, "S14X-139b"), show(empty)).toEqual([expect.stringMatching(/^FAIL {2}S14X-139b .*said no function changed, though its commit changed y$/)]);
    const behind = run({ gh: { verifyConclusion: "failure", annotations: [failure("Deployed code is not this commit", "y serves 'y.2026-11-02.1' and this commit is 'y.2026-11-17.1'.")] } }).lines;
    expect(status(behind, "S14X-139b"), show(behind)).toEqual(["INFO"]);
  });

  it("RC-S13-108: a section 92 that passes mail-watch on pg_cron's count", () => {
    const { lines } = run({ co: checkout({ s92: S92_PASSING }) });
    expect(S92_PASSING).not.toBe(S92);
    expect(tag(lines, "RC-S13-108"), show(lines)).toEqual([expect.stringMatching(/^FAIL {2}RC-S13-108 section 92, given 96 runs with none failed, printed: PASS {2}mail-watch ran 96 times/)]);
  });
});

describe("it never writes, and never prints the key", () => {
  it("reads get_cron_health, the ledger and GitHub with GETs only; the smoke reached nothing", () => {
    const { calls, out } = run();
    expect(calls.filter((c) => c.startsWith("R "))).toEqual([`R get_cron_health {"p_hours":24}`]);
    expect(calls.filter((c) => c.startsWith("ledger "))).toEqual(["ledger --json"]);
    expect(calls.filter((c) => c.startsWith("curl "))).toEqual([]);
    const gh = calls.filter((c) => c.startsWith("gh "));
    expect(gh.length).toBeGreaterThan(5);
    for (const c of gh) {
      expect(c, c).toMatch(/^gh (auth status|run list |run view \d+ --json |api repos\/\{owner\}\/\{repo\}\/(contents|check-runs)\/)/);
      expect(c, c).not.toMatch(/ (-X|--method|-f|-F|--field|--raw-field|--input) /);
    }
    expect(out).not.toContain(KEY);
  });
});
