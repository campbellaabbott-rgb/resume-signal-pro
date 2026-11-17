// @vitest-environment node
//
// Node, not jsdom: this file runs the ledger in a throwaway git repository
// and section 49 in bash, through child_process.
/**
 * "MIGRATIONS BEFORE FUNCTIONS" IS NOT AN ORDER LOVABLE KEEPS (NB-33).
 *
 * The roadmap of 2026-11-15 said the cost wave's deploy was pending. It was
 * not: Lovable had deployed every function and the frontend, and twelve of
 * the fourteen migrations stayed unapplied. The message's order (the
 * migrations, then the functions) is a request Lovable Cloud does not honour,
 * so a function that calls an RPC or a table that only an unapplied
 * migration creates is live without it.
 *
 * The ledger now finds every such call (the function's own files and the
 * _shared modules it imports, against what the pending, held and
 * never-applied files create and no applied file does), and each one stops
 * the message (exit 6) until absentTolerant in docs/deploy-ledger.json says
 * how that function copes while the object is absent. Section 49 FAILs the
 * unrecorded ones and prints the recorded ones as INFO.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
let L: typeof import("../../scripts/deploy-ledger.mjs");
const realFetch = globalThis.fetch;
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
  L = await import("../../scripts/deploy-ledger.mjs");
  vi.unstubAllGlobals();
});
const dirs: string[] = [];
afterAll(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllGlobals();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NEW = "20261201100000_a_new_reader.sql";
const OLD = "20261001100000_the_old_reader.sql";
const NEVER = "20261103120000_never_applied.sql";
const SQL: Record<string, string> = {
  [OLD]: "CREATE OR REPLACE FUNCTION public.old_reader() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;\n",
  [NEW]: "-- CREATE FUNCTION public.ghost() is only prose here\nCREATE OR REPLACE FUNCTION public.new_reader() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;\nCREATE TABLE IF NOT EXISTS public.new_rows (id int);\nCREATE OR REPLACE FUNCTION public.old_reader() RETURNS int LANGUAGE sql AS $$ SELECT 3 $$;\n",
  [NEVER]: "CREATE OR REPLACE FUNCTION public.never_made() RETURNS int LANGUAGE sql AS $$ SELECT 4 $$;\n",
};
const sqlOf = (f: string) => SQL[f] ?? "";

describe("which calls run ahead of their migration", () => {
  const sources = {
    alpha: ['await db.rpc("new_reader", {});', 'await db.from("new_rows").select("id");'],
    beta: ['await db.rpc("old_reader");', 'await db.rpc("ghost");'],
    gamma: ['await fetch(`${url}/rest/v1/rpc/new_reader`, { method: "POST" });', 'await fetch(`${url}/rest/v1/new_rows?select=id`);'],
    delta: ['await db.rpc("never_made");'],
  };

  it("a call to an RPC or table only an unapplied file creates is an error, whether by the client or by its REST path", () => {
    const r = L.callsAheadOfMigrations({ sources, pending: [NEW, NEVER], applied: [OLD], sqlOf, policy: {} });
    expect(r.calls.map((c) => `${c.fn}:${c.object}`)).toEqual(["alpha:new_reader", "alpha:new_rows", "delta:never_made", "gamma:new_reader", "gamma:new_rows"]);
    expect(r.errors).toHaveLength(5);
    expect(r.errors[0]).toMatch(/^alpha calls new_reader, which only 20261201100000_a_new_reader\.sql creates, and Lovable deploys functions ahead of their migrations .*absentTolerant "alpha:new_reader"/);
  });

  it("a call to what an applied file already creates, or to a name only a comment mentions, is not", () => {
    const r = L.callsAheadOfMigrations({ sources: { beta: sources.beta }, pending: [NEW], applied: [OLD], sqlOf, policy: {} });
    expect(r).toEqual({ calls: [], errors: [] });
  });

  it("once absentTolerant records how the function copes, the call is listed with that and stops nothing", () => {
    const policy = { absentTolerant: { "alpha:new_reader": "falls back to the old reader on PGRST202", "alpha:new_rows": "  " } };
    const r = L.callsAheadOfMigrations({ sources: { alpha: sources.alpha }, pending: [NEW], applied: [OLD], sqlOf, policy });
    expect(r.calls).toEqual([
      { fn: "alpha", object: "new_reader", files: [NEW], tolerated: "falls back to the old reader on PGRST202" },
      { fn: "alpha", object: "new_rows", files: [NEW], tolerated: null },
    ]);
    expect(r.errors, "a blank entry records nothing").toHaveLength(1);
    expect(r.errors[0]).toMatch(/^alpha calls new_rows/);
  });

  it("with nothing pending there is nothing ahead", () => {
    expect(L.callsAheadOfMigrations({ sources, pending: [], applied: [OLD, NEW], sqlOf, policy: {} })).toEqual({ calls: [], errors: [] });
  });
});

// The real script, end to end, in a repository of its own. Its preflights go
// to a port nothing listens on, so no request leaves this machine.
const CLEAN_ENV: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
function repo(policyExtra: Record<string, unknown> = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "calls ahead ")));
  dirs.push(dir);
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, env: CLEAN_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const put = (p: string, body: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); };
  g("init", "-q", "-b", "main");
  mkdirSync(join(dir, "scripts"));
  copyFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), join(dir, "scripts/deploy-ledger.mjs"));
  put("package.json", JSON.stringify({ type: "module" }));
  put("docs/deploy-ledger.json", JSON.stringify({
    supabaseUrl: "http://127.0.0.1:1", drizzleBaseline: "20260101000000", neverApply: [], appliedOutsideDrizzle: [], holdUntilVerified: [], migrationOrder: {}, verifiedDeploys: [], ...policyExtra,
  }));
  put("drizzle/migrations/0001_20261001100000_the_old_reader.sql", SQL[OLD]);
  put(`supabase/migrations/${OLD}`, SQL[OLD]);
  put(`supabase/migrations/${NEW}`, SQL[NEW]);
  put("supabase/functions/_shared/reader.ts", 'export const read = (db: any) => db.rpc("new_reader");\n');
  put("supabase/functions/alpha/index.ts", 'import { read } from "../_shared/reader.ts";\nconst FN_BUILD = "alpha.2026-12-01.1";\nconst cors = { "x-fn-build": FN_BUILD };\nexport { read, cors };\n');
  put("supabase/functions/alpha/reader_test.ts", 'await db.rpc("new_rows_only_a_test_calls");\n');
  g("add", "-A");
  g("-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-m", "one function, one pending reader");
  const run = (flag: string) => {
    try { return { code: 0, out: execFileSync(process.execPath, [join(dir, "scripts/deploy-ledger.mjs"), flag], { cwd: dir, env: CLEAN_ENV, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }) }; }
    catch (e) { const x = e as { status?: number; stdout?: string }; return { code: x.status ?? 1, out: String(x.stdout ?? "") }; }
  };
  return { run };
}

describe("the report: a call through a _shared module stops the message", () => {
  it("--json lists the call under aheadOfMigration and exits 6; --draft refuses", () => {
    const r = repo();
    const json = r.run("--json");
    expect(json.code, json.out).toBe(6);
    const j = JSON.parse(json.out);
    expect(j.aheadOfMigration.calls).toEqual([{ fn: "alpha", object: "new_reader", files: [NEW], tolerated: null }]);
    expect(j.migrations.pending).toEqual([NEW]);
    const draft = r.run("--draft");
    expect(draft.out).toMatch(/UNCHECKED {2}alpha calls new_reader, which only 20261201100000_a_new_reader\.sql creates/);
    expect(draft.out).toMatch(/REFUSED: a function above calls what only an unapplied migration creates/);
  });

  it("positive control: recorded under absentTolerant, the same tree prints its message", () => {
    const r = repo({ absentTolerant: { "alpha:new_reader": "answers without the count while new_reader is absent" } });
    const json = r.run("--json");
    expect(json.code, "only the unreachable preflight is left (exit 4)").toBe(4);
    expect(JSON.parse(json.out).aheadOfMigration.errors).toEqual([]);
    const draft = r.run("--draft");
    expect(draft.out).toMatch(/TOLERATED {2}alpha calls new_reader/);
    expect(draft.out).not.toMatch(/REFUSED/);
    expect(draft.out).toMatch(/^DRAFT from main at /m);
  });
});

describe("section 49 FAILs a call ahead of its migration until it is recorded", () => {
  const runSection49 = (json: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "vd49-ahead-"));
    dirs.push(dir);
    mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
    writeFileSync(join(dir, "scripts", "deploy-ledger.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(json))}); process.exitCode = 6;\n`);
    const body = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/49-deploy-ledger.sh"), "utf8");
    return execFileSync("bash", ["-c", body], { cwd: dir, encoding: "utf8", timeout: 30_000 }).split("\n").filter(Boolean);
  };
  const base = { head: "abc", checkout: { refusal: null }, toDeploy: [], unbumped: [], sharedOnly: [], noMarker: [], rows: [], unreachable: [], migrations: { pending: [NEW], hold: [] }, phases: { errors: [] }, ownerSteps: [] };

  it("an unrecorded call is a FAIL, a recorded one INFO", () => {
    const lines = runSection49({ ...base, aheadOfMigration: { calls: [
      { fn: "alpha", object: "new_reader", files: [NEW], tolerated: null },
      { fn: "beta", object: "new_rows", files: [NEW], tolerated: "reads nothing while it is absent" },
    ], errors: ["x"] } });
    expect(lines.some((l) => l.startsWith(`FAIL  alpha calls new_reader, which only ${NEW} creates, and Lovable deploys functions ahead of their migrations`)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => l === `INFO  beta calls new_rows, which only ${NEW} creates; absentTolerant records how it copes: reads nothing while it is absent`), lines.join("\n")).toBe(true);
  });

  it("an older ledger with no aheadOfMigration key prints nothing about it", () => {
    const lines = runSection49({ ...base });
    expect(lines.some((l) => / calls /.test(l))).toBe(false);
  });
});
