// @vitest-environment node
//
// Node, not jsdom: the verify step runs in bash against a local server.
/**
 * THE DEPLOY THAT REPORTS SUCCESS AND SHIPS STALE CODE.
 *
 * Twice on 2026-08-07 a deploy completed and the live functions were two
 * versions behind: origin/main held BUILD_VERSION 2026-08-07.3 while job-board
 * answered 2026-08-07.1, because the project copy had stopped pulling from
 * GitHub. Nothing surfaced it. It was caught by hand-diffing the deployed
 * bundle against the repo, twice, and it would have gone unnoticed otherwise.
 *
 * The workflow this file guards exists mostly for its SECOND job. Deploying
 * automatically is convenient; proving what is live matches the commit is the
 * part that closes a hole this project has actually fallen into.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseDocument } from "yaml";

const wf = readFileSync(resolve(__dirname, "../../.github/workflows/deploy.yml"), "utf8");

describe("verification is not optional", () => {
  it("runs even when the deploy job skipped or failed", () => {
    // "Is the live code the code I pushed" is worth answering even when this
    // workflow did not do the deploying — a human Lovable session is still
    // the normal path here.
    expect(wf).toMatch(/needs: deploy\s*\n\s*if: always\(\)/);
  });

  it("waits before reading, so propagation is not mistaken for a stale deploy", () => {
    expect(wf).toMatch(/sleep 45/);
  });
});

/**
 * THE VERIFY STEP, RUN (L12-08, S14X-139). It read SUPABASE_URL /
 * SUPABASE_ANON_KEY from repo secrets that were never set, printed a warning
 * and exited 0 on every push since it was written (L12-08). Then it compared
 * job-board's BUILD_VERSION alone, whatever the push changed (S14X-139): a
 * push that changed mail-watch went green on job-board's build while
 * mail-watch served an older one, and a push that changed no function went
 * red whenever job-board lagged main.
 *
 * Now it judges every function the push changed, through the ledger's
 * --push-verdict. This runs the step as GitHub does (bash -eo pipefail) in a
 * throwaway repository, against a local server standing in for the functions'
 * OPTIONS preflights, and reads its exit code and annotations. A fake curl on
 * PATH answers job-board's status, so the step as it was is judged by the
 * same cases.
 */
describe("the verify step judges every function the push changed, and cannot pass without comparing", () => {
  type Step = { name?: string; run?: string };
  const steps = ((parseDocument(wf).toJS() as { jobs?: { verify?: { steps?: Step[] } } }).jobs?.verify?.steps ?? []);
  const step = steps.find((s) => /--push-verdict|BUILD_VERSION/.test(s.run ?? ""));
  const CLEAN: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

  // What each function's preflight answers; "hangup" closes the connection.
  let live: Record<string, string> = {};
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const fn = /^\/functions\/v1\/([^/?]+)/.exec(req.url ?? "")?.[1] ?? "";
      if (live[fn] === "hangup") { req.socket.destroy(); return; }
      res.writeHead(200, live[fn] ? { "x-fn-build": live[fn] } : {});
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const dirs: string[] = [];

  const MW = (build: string, body = "1") => `const FN_BUILD = "mail-watch.${build}";\nconst cors = { "x-fn-build": FN_BUILD };\nexport const run = () => ${body};\n`;
  /** A repository at commit A (job-board .102, mail-watch 11-12.1, alpha importing a _shared module), then `change` as commit B. */
  function repo(change: (put: (p: string, body: string) => void) => void) {
    const dir = mkdtempSync(join(tmpdir(), "deploy-verify-"));
    dirs.push(dir);
    const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: CLEAN, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const put = (p: string, body: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); };
    const commit = (m: string) => { g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", m); return g("rev-parse", "HEAD"); };
    g("init", "-q", "-b", "main");
    mkdirSync(join(dir, "scripts"));
    copyFileSync(resolve(__dirname, "../../scripts/deploy-ledger.mjs"), join(dir, "scripts/deploy-ledger.mjs"));
    put("docs/deploy-ledger.json", JSON.stringify({ supabaseUrl: `http://127.0.0.1:${port}` }));
    put(".env", `VITE_SUPABASE_PUBLISHABLE_KEY="pk_test"\nVITE_SUPABASE_URL="http://127.0.0.1:${port}"\n`);
    put("supabase/functions/job-board/index.ts", 'const BUILD_VERSION = "2026-09-09.102";\nconst cors = { "x-fn-build": `job-board.${BUILD_VERSION}` };\nexport { cors };\n');
    put("supabase/functions/mail-watch/index.ts", MW("2026-11-12.1"));
    put("supabase/functions/_shared/util.ts", "export const util = 1;\n");
    put("supabase/functions/alpha/index.ts", 'import { util } from "../_shared/util.ts";\nconst FN_BUILD = "alpha.2026-11-01.1";\nconst cors = { "x-fn-build": FN_BUILD };\nexport { util, cors };\n');
    put("README.md", "a\n");
    const A = commit("A");
    change(put);
    const B = commit("B");
    return { dir, A, B };
  }

  function verify(dir: string, before: string, jobBoardStatus: string): Promise<{ code: number; out: string }> {
    if (!step?.run) throw new Error("no comparison step in the verify job");
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "bin", "curl"), `#!/bin/bash\necho '${JSON.stringify({ version: jobBoardStatus })}'\n`);
    chmodSync(join(dir, "bin", "curl"), 0o755);
    return new Promise((done) => {
      const p = spawn("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", step.run as string], { cwd: dir, env: { ...CLEAN, BEFORE: before, PATH: `${join(dir, "bin")}:${process.env.PATH}` } });
      let out = "";
      p.stdout.on("data", (d) => { out += d; });
      p.stderr.on("data", (d) => { out += d; });
      p.on("close", (code) => done({ code: code ?? 1, out }));
    });
  }
  const bumpMailWatch = (put: (p: string, b: string) => void) => put("supabase/functions/mail-watch/index.ts", MW("2026-11-17.1", "2"));

  it("positive control: the push changed mail-watch and mail-watch serves this commit's build; job-board lagging is not this push's", async () => {
    const r = repo(bumpMailWatch);
    live = { "mail-watch": "mail-watch.2026-11-17.1", "job-board": "job-board.2026-09-09.101" };
    const v = await verify(r.dir, r.A, "2026-09-09.101");
    expect(v.code, v.out).toBe(0);
    expect(v.out).toContain("::notice title=Deploy verified::1 function(s) this push changed serve this commit's builds or later: mail-watch.2026-11-17.1");
  });

  it("the push changed mail-watch and production serves an older mail-watch: red, naming both builds, though job-board matches", async () => {
    const r = repo(bumpMailWatch);
    live = { "mail-watch": "mail-watch.2026-11-12.1", "job-board": "job-board.2026-09-09.102" };
    const v = await verify(r.dir, r.A, "2026-09-09.102");
    expect(v.code, v.out).not.toBe(0);
    expect(v.out).toContain("::error title=Deployed code is not this commit::mail-watch serves 'mail-watch.2026-11-12.1' and this commit is 'mail-watch.2026-11-17.1'.");
    expect(v.out).not.toMatch(/Deploy verified/);
  });

  it("this build or later: a later live build passes, and .9 is older than .10", async () => {
    const r = repo((put) => put("supabase/functions/mail-watch/index.ts", MW("2026-11-17.10", "2")));
    live = { "mail-watch": "mail-watch.2026-11-17.12" };
    expect((await verify(r.dir, r.A, "x")).code).toBe(0);
    live = { "mail-watch": "mail-watch.2026-11-17.9" };
    expect((await verify(r.dir, r.A, "x")).code, "compared as text, .9 would sort after .10").not.toBe(0);
  });

  it("a change to a _shared module is judged in every function that imports it", async () => {
    const r = repo((put) => put("supabase/functions/_shared/util.ts", "export const util = 2;\n"));
    live = { alpha: "alpha.2026-10-31.4" };
    const v = await verify(r.dir, r.A, "2026-09-09.102");
    expect(v.code, v.out).not.toBe(0);
    expect(v.out).toContain("alpha serves 'alpha.2026-10-31.4' and this commit is 'alpha.2026-11-01.1'");
    live = { alpha: "alpha.2026-11-01.1" };
    expect((await verify(r.dir, r.A, "2026-09-09.102")).code).toBe(0);
  });

  it("a push that changed no function passes, saying nothing was compared", async () => {
    const r = repo((put) => put("README.md", "b\n"));
    live = { "job-board": "job-board.2026-09-09.90" };
    const v = await verify(r.dir, r.A, "2026-09-09.90");
    expect(v.code, v.out).toBe(0);
    expect(v.out).toContain("::notice title=No function changed::this push changed no edge function, so no live build was compared");
  });

  it("a function that does not answer its preflight is not verified, and the run fails", async () => {
    const r = repo(bumpMailWatch);
    live = { "mail-watch": "hangup", "job-board": "job-board.2026-09-09.102" };
    const v = await verify(r.dir, r.A, "2026-09-09.102");
    expect(v.code, v.out).not.toBe(0);
    expect(v.out).toContain("::error title=Deploy not verified::mail-watch did not answer its preflight, so nothing was compared for it.");
  });

  it("with no readable commit before the push it diffs against the parent; with neither, it fails as not compared", async () => {
    const r = repo(bumpMailWatch);
    live = { "mail-watch": "mail-watch.2026-11-12.1" };
    const zeros = await verify(r.dir, "0000000000000000000000000000000000000000", "x");
    expect(zeros.code, zeros.out).not.toBe(0);
    expect(zeros.out).toContain("mail-watch serves 'mail-watch.2026-11-12.1'");
    const lone = repo((put) => put("README.md", "c\n"));
    execFileSync("bash", ["-c", "git checkout -q --orphan solo && git -c user.name=t -c user.email=t@t -c core.hooksPath=/dev/null commit -q -m solo"], { cwd: lone.dir, env: CLEAN });
    const v = await verify(lone.dir, "1111111111111111111111111111111111111111", "2026-09-09.102");
    expect(v.code, v.out).not.toBe(0);
    expect(v.out).toMatch(/Deploy not verified::.*nothing was compared/);
  });

  it("the ledger carries the project URL the step reads", () => {
    const policy = JSON.parse(readFileSync(resolve(__dirname, "../../docs/deploy-ledger.json"), "utf8"));
    expect(policy.supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
  });
});

/**
 * NO MIGRATION IS APPLIED FROM THIS WORKFLOW (S14X-246). A manual job ran
 * `supabase db push --project-ref <production>` with the CLI at its latest
 * version, on a dispatch typed "apply". A push applies every file the
 * database has not recorded: it ignores the ledger's neverApply, hold and
 * order rules. Migrations reach production through the ledger's Lovable
 * message and the owner's SQL editor steps only. Comments are set aside, so
 * the header that tells this history is not read as a command.
 */
describe("migrations are never applied from this workflow", () => {
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  it("no step runs a migration command or reads the database password", () => {
    expect(code).not.toMatch(/supabase\s+db\s+push/);
    expect(code).not.toMatch(/supabase\s+(db|migration)\s+(push|up|reset|repair)\b/);
    expect(code).not.toMatch(/SUPABASE_DB_PASSWORD/);
  });

  it("the dispatch asks for nothing, and the jobs are the deploy and its check", () => {
    const doc = parseDocument(wf).toJS() as { on?: { workflow_dispatch?: { inputs?: Record<string, unknown> } | null }; jobs?: Record<string, unknown> };
    expect(doc.on?.workflow_dispatch?.inputs ?? {}).toEqual({});
    expect(Object.keys(doc.jobs ?? {})).toEqual(["deploy", "verify"]);
  });
});

describe("the deploy itself", () => {
  it("deploys ALL functions, never one", () => {
    // 2026-08-03: a single-function deploy was followed by 79 of 80 functions
    // returning NOT_FOUND_FUNCTION_BLOB — an eight-minute outage covering every
    // checkout path and the scanner.
    expect(wf).toMatch(/supabase functions deploy --project-ref/);
    expect(wf).not.toMatch(/functions deploy [a-z-]+ --project-ref/);
  });

  it("skips with a notice when unconfigured instead of failing", () => {
    expect(wf).toMatch(/ready=false/);
    expect(wf).toMatch(/::notice title=Deploy skipped::/);
  });

  it("serialises runs so two deploys cannot race", () => {
    expect(wf).toMatch(/concurrency:\s*\n\s*#[^\n]*\n\s*#[^\n]*\n\s*group: deploy-main/);
    expect(wf).toMatch(/cancel-in-progress: false/);
  });
});
