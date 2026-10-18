// @vitest-environment node
/**
 * A MET HOLD, A ROLLBACK AND A STUB-LESS MIGRATION ARE READ BY THE LEDGER
 * (S12 sweep, ops: S12-032, S12-161, S12-162).
 *
 * WHAT WAS WRONG.
 *   S12-032  holdUntilVerified carried its conditions as prose. All three of
 *            wave 3's holds were met while every generated message still said
 *            "Do NOT apply yet", so an owner pasting it would have skipped the
 *            shortlist lockdown (20261009112000) for good.
 *   S12-161  a revert on main reads "live-ahead": no message named the
 *            function, so a rollback could not go through the process.
 *   S12-162  section 49 could not read clean: four of the eleven FAILs after
 *            wave 3 were the ledger's own (two migrations Lovable applied
 *            without a stub, two MUST BUMPs a hand-typed verifiedDeploys entry
 *            had not yet cleared).
 *
 * WHAT HOLDS NOW: a hold names releaseWhen builds the ledger reads, a met
 * hold is RELEASABLE in the message and a FAIL in section 49, a hold it cannot
 * check stops the message; a declared rollback is a deploy, an undeclared
 * live-ahead row heads the message as a STOP; a migration whose cron jobs
 * production lists active is applied by behaviour; the verifiedDeploys entry
 * is generated. The pure rules run on fixtures and on the real policy;
 * section 49 runs in bash against a stub ledger. No network, no git.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
let L: typeof import("../../scripts/deploy-ledger.mjs");
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
  L = await import("../../scripts/deploy-ledger.mjs");
  vi.unstubAllGlobals();
});

type Row = { fn: string; want: string | null; have: string | null; state: string; rollbackFrom?: string };
const HELD = "20261011103000_a_prune.sql";
const holdPolicy = (releaseWhen?: unknown) => ({ holdUntilVerified: [{ stamp: "20261011103000", until: "section 86 passes", ...(releaseWhen === undefined ? {} : { releaseWhen }) }] });
const rows = (jb: string, mcp: string): Row[] => [
  { fn: "job-board", want: "job-board.2026-09-09.93", have: jb, state: L.rowState("job-board.2026-09-09.93", jb) },
  { fn: "agent-mcp", want: "agent-mcp.2026-10-11.3", have: mcp, state: L.rowState("agent-mcp.2026-10-11.3", mcp) },
];
const WHEN = ["fn:job-board@2026-09-09.93", "fn:agent-mcp@2026-10-11.3"];

describe("S12-032: a hold is checked by machine", () => {
  it("is releasable once every function it names answers the build, and not before", () => {
    const met = L.holdStates([HELD], holdPolicy(WHEN), rows("job-board.2026-09-09.93", "agent-mcp.2026-10-11.4"));
    expect(met.errors).toEqual([]);
    expect(met.holds).toHaveLength(1);
    expect(met.holds[0].releasable).toBe(true);
    expect(met.holds[0].conditions.map((c: { met: boolean }) => c.met)).toEqual([true, true]);

    const half = L.holdStates([HELD], holdPolicy(WHEN), rows("job-board.2026-09-09.93", "agent-mcp.2026-10-09.71"));
    expect(half.holds[0].releasable).toBe(false);
    expect(half.holds[0].conditions.find((c: { fn: string }) => c.fn === "agent-mcp")).toMatchObject({ met: false, have: "agent-mcp.2026-10-09.71" });
  });

  it("a hold the ledger cannot check is an error, never a silent 'Do NOT apply'", () => {
    const none = L.holdStates([HELD], holdPolicy(), rows("job-board.2026-09-09.92", "agent-mcp.2026-10-09.71"));
    expect(none.errors.join("\n")).toMatch(/names no releaseWhen/);
    expect(none.holds[0].releasable).toBe(false);
    const bad = L.holdStates([HELD], holdPolicy(["section 86 passes", "fn:no-such@2026-10-11.1", "fn:job-board@2026-09-09.99"]), rows("job-board.2026-09-09.93", "agent-mcp.2026-10-11.3"));
    const e = bad.errors.join("\n");
    expect(e).toMatch(/releaseWhen "section 86 passes" is not/);
    expect(e).toMatch(/main has no function no-such/);
    expect(e).toMatch(/waits for job-board\.2026-09-09\.99, but main carries job-board\.2026-09-09\.93: it can never be released/);
    expect(bad.holds[0].releasable, "a condition that cannot be read is not met").toBe(false);
  });

  it("an entry that names no held pending migration is stale", () => {
    expect(L.holdStates([], holdPolicy(WHEN), rows("x", "y")).stale).toEqual(["20261011103000"]);
  });

  it("the message says RELEASABLE for a met hold, and Do NOT apply (with what it waits for) for the rest", () => {
    const p = L.migrationPhases(["20261011100000_a.sql"], {}, []);
    const met = L.holdStates([HELD], holdPolicy(WHEN), rows("job-board.2026-09-09.93", "agent-mcp.2026-10-11.3")).holds;
    const msg = L.lovableMessage({ head: "abc", phases: p, hold: [HELD], holds: met }).join("\n");
    expect(msg).toMatch(/RELEASABLE, still held: 20261011103000_a_prune\.sql\. Every condition it names is live \(job-board answers job-board\.2026-09-09\.93; agent-mcp answers agent-mcp\.2026-10-11\.3\)/);
    expect(msg).toMatch(/section 86 passes/);
    expect(msg).not.toMatch(/Do NOT apply yet: 20261011103000/);

    const waiting = L.holdStates([HELD], holdPolicy(WHEN), rows("job-board.2026-09-09.92", "agent-mcp.2026-10-11.3")).holds;
    const msg2 = L.lovableMessage({ head: "abc", phases: p, hold: [HELD], holds: waiting }).join("\n");
    expect(msg2).toMatch(/Do NOT apply yet: 20261011103000_a_prune\.sql \(waits for job-board\.2026-09-09\.93 or later, live job-board\.2026-09-09\.92\)/);
    expect(msg2).not.toMatch(/RELEASABLE/);
  });

  it("every hold in the real policy names releaseWhen builds this checkout carries", () => {
    const fnDir = resolve(ROOT, "supabase/functions");
    const repoRows: Row[] = readdirSync(fnDir).filter((d) => d !== "_shared").flatMap((fn) => {
      let src = ""; try { src = readFileSync(join(fnDir, fn, "index.ts"), "utf8"); } catch { return []; }
      const want = L.buildOf(fn, src);
      return [{ fn, want, have: null, state: want ? "deploy (no live header)" : "no-marker" }];
    });
    const files = readdirSync(resolve(ROOT, "supabase/migrations"));
    const held = (POLICY.holdUntilVerified as Array<{ stamp: string }>).map((h) => files.find((f) => f.startsWith(`${h.stamp}_`))).filter(Boolean) as string[];
    expect(held.length, "each hold names a migration file").toBe(POLICY.holdUntilVerified.length);
    const s = L.holdStates(held, POLICY, repoRows);
    expect(s.errors).toEqual([]);
    for (const h of s.holds) expect(h.conditions.length, h.file).toBeGreaterThan(0);
  });

  it("the report stops its message on a hold it cannot check, through the same errors as an order rule", () => {
    const src = readFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/const holds = holdStates\(mig\.hold, POLICY, rows\);\s*phases\.errors\.push\(\.\.\.holds\.errors\);/);
    expect(src).toMatch(/lovableMessage\(\{ head, draftOf, phases, hold: mig\.hold, holds: holds\.holds,/);
  });

  it("COMPLIANCE.md credits the shortlist guard trigger to the migration that creates it", () => {
    const doc = readFileSync(resolve(ROOT, "COMPLIANCE.md"), "utf8");
    const row = doc.split("\n").find((l) => l.includes("shortlist_candidates_guard")) ?? "";
    expect(row).toMatch(/20261009112000/);
    const guard = readFileSync(resolve(ROOT, "supabase/migrations", readdirSync(resolve(ROOT, "supabase/migrations")).find((f) => f.startsWith("20261009112000_"))!), "utf8");
    expect(guard).toMatch(/CREATE TRIGGER shortlist_candidates_guard/);
  });

  it("COMPLIANCE.md says the guard is applied only with the staged-runner stub that proves it, on the day the stub landed", () => {
    const doc = readFileSync(resolve(ROOT, "COMPLIANCE.md"), "utf8");
    const row = doc.split("\n").find((l) => l.includes("shortlist_candidates_guard")) ?? "";
    const stub = readdirSync(resolve(ROOT, "drizzle/migrations")).find((f) => /^\d{4}_20261009112000_/.test(f));
    expect(stub, "no staged-runner stub records 20261009112000 as applied").toBeTruthy();
    // Lovable wrote that stub on 2026-10-12 (commit 7bdb529a); the S12 sweep that morning still read the guard as not live.
    expect(row).toMatch(/20261009112000, applied 2026-10-12\)/);
  });
});

describe("S12-161: a declared rollback is a deploy", () => {
  const measured: Row[] = [
    { fn: "a", want: "a.2026-10-11.2", have: "a.2026-10-11.3", state: "live-ahead" },
    { fn: "b", want: "b.2026-10-11.2", have: "b.2026-10-11.5", state: "live-ahead" },
    { fn: "c", want: "c.2026-10-11.2", have: "c.2026-10-11.2", state: "live" },
  ];
  it("the declared function is deployed at main's build; an undeclared one stays live-ahead (exit 8)", () => {
    const rb = L.applyRollbacks(measured, { rollbacks: { a: { from: "a.2026-10-11.3", why: "broke checkout" } } });
    expect(rb.rows.find((r: Row) => r.fn === "a")).toMatchObject({ state: "deploy (rollback)", rollbackFrom: "a.2026-10-11.3" });
    expect(rb.rows.filter((r: Row) => r.state.startsWith("deploy")).map((r: Row) => r.fn)).toEqual(["a"]);
    expect(L.liveAheadRows(rb.rows).map((r: Row) => r.fn)).toEqual(["b"]);
    expect(rb.stale).toEqual([]);
  });

  it("a declaration that names another build rolls nothing back and is reported stale", () => {
    const rb = L.applyRollbacks(measured, { rollbacks: { b: { from: "b.2026-10-11.4" }, _note: "x" } });
    expect(L.liveAheadRows(rb.rows).map((r: Row) => r.fn)).toEqual(["a", "b"]);
    expect(rb.stale).toEqual([{ fn: "b", from: "b.2026-10-11.4" }]);
  });

  it("the message names the rollback in its deploy step, and an undeclared live-ahead function heads it as a STOP", () => {
    const rb = L.applyRollbacks(measured, { rollbacks: { a: { from: "a.2026-10-11.3" } } });
    const msg = L.lovableMessage({
      head: "abc", phases: L.migrationPhases([], {}, rb.rows),
      toDeploy: rb.rows.filter((r: Row) => r.state.startsWith("deploy")), liveAhead: L.liveAheadRows(rb.rows),
    });
    expect(msg.join("\n")).toMatch(/- a: a\.2026-10-11\.2 \(a declared rollback from the live a\.2026-10-11\.3\)/);
    const stop = msg.findIndex((l: string) => /^STOP: 1 function\(s\) answer a build later than the one main carries/.test(l));
    expect(stop, msg.join("\n")).toBeGreaterThan(0);
    expect(msg[stop]).toMatch(/b \(live b\.2026-10-11\.5, main b\.2026-10-11\.2\)/);
    expect(stop).toBeLessThan(msg.findIndex((l: string) => /^\d+\. Deploy these/.test(l)));
  });

  it("the report re-states the rows before it computes what to deploy", () => {
    const src = readFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/const rb = applyRollbacks\(measured, POLICY\);\s*const rows = rb\.rows;/);
    expect(src.indexOf("const rows = rb.rows;")).toBeLessThan(src.indexOf('const toDeploy = rows.filter((r) => r.state.startsWith("deploy"));'));
  });
});

describe("S12-162: a migration live by behaviour, and a generated record", () => {
  const policy = { appliedByBehaviour: { "20261008125000": { cronJobs: ["send-search-digest", "industry-corrections-digest"] }, "20261008128000": { cronJobs: ["check-error-spikes"] } } };
  const pending = ["20261008125000_digests.sql", "20261008128000_spikes.sql", "20261011100000_other.sql"];
  const cron = (active: Record<string, boolean>) => Object.entries(active).map(([ch_jobname, ch_active]) => ({ ch_jobname, ch_active, ch_runs: 3 }));

  it("is applied when every cron job it schedules is listed active", () => {
    const r = L.behaviourApplied(pending, policy, cron({ "send-search-digest": true, "industry-corrections-digest": true, "check-error-spikes": true }));
    expect(r.pending).toEqual(["20261011100000_other.sql"]);
    expect(r.proven.map((p: { file: string }) => p.file)).toEqual(["20261008125000_digests.sql", "20261008128000_spikes.sql"]);
  });

  it("stays pending, with the reason, when a job is missing or inactive, or the reader could not be read", () => {
    const r = L.behaviourApplied(pending, policy, cron({ "send-search-digest": true, "industry-corrections-digest": false }));
    expect(r.pending).toEqual(pending);
    expect(r.unproven.map((u: { why: string }) => u.why)).toEqual([
      "get_cron_health lists no active industry-corrections-digest",
      "get_cron_health lists no active check-error-spikes",
    ]);
    const blind = L.behaviourApplied(pending, policy, null);
    expect(blind.pending).toEqual(pending);
    expect(blind.unproven.every((u: { why: string }) => /could not be read/.test(u.why))).toBe(true);
  });

  it("the real policy proves both stub-less wave-2 migrations by their jobs, and the jobs are the ones they schedule", () => {
    const files = readdirSync(resolve(ROOT, "supabase/migrations"));
    for (const [stamp, proof] of Object.entries(POLICY.appliedByBehaviour).filter(([k]) => !k.startsWith("_")) as Array<[string, { cronJobs: string[] }]>) {
      const sql = readFileSync(resolve(ROOT, "supabase/migrations", files.find((f) => f.startsWith(`${stamp}_`))!), "utf8");
      for (const job of proof.cronJobs) expect(sql, `${stamp} schedules ${job}`).toContain(`'${job}'`);
      expect(POLICY.appliedOutsideDrizzle).not.toContain(stamp);
    }
  });

  it("the record names main's commit and every function answering exactly main's build", () => {
    const e = L.verifiedDeployEntry({ commit: "35559389abcdef", date: "2026-10-12", rows: [
      { fn: "z", want: "z.2026-10-11.2", have: "z.2026-10-11.2", state: "live" },
      { fn: "a", want: "a.2026-10-11.2", have: "a.2026-10-11.2", state: "live" },
      { fn: "m", want: "m.2026-10-11.2", have: "m.2026-10-11.1", state: "deploy" },
    ] });
    expect(e.commit).toBe("35559389");
    expect(e.functions).toEqual({ a: "a.2026-10-11.2", z: "z.2026-10-11.2" });
    expect(Object.keys(e.functions)).toEqual(["a", "z"]);
  });

  it("the record is refused off main and while anything is left to deploy", () => {
    expect(L.recordRefusal({ refusal: "HEAD x is 3 commit(s) behind origin/main y" })).toMatch(/behind origin\/main/);
    expect(L.recordRefusal({ toDeploy: [{ fn: "job-board" }], liveAhead: [{ fn: "agent-mcp" }] })).toMatch(/2 function\(s\) do not answer main's build yet \(job-board, agent-mcp\)/);
    expect(L.recordRefusal({})).toBeNull();
  });

  it("the report moves a proven migration to applied before it judges late stamps", () => {
    const src = readFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/const behaviour = behaviourApplied\(mig\.pending, POLICY, needsProof \? await cronHealth\(BASE\) : null\);\s*mig\.pending = behaviour\.pending;/);
    expect(src.indexOf("mig.pending = behaviour.pending;")).toBeLessThan(src.indexOf("const late = lateStampViolations("));
    expect(src).toMatch(/args\.has\("--record-deploy"\)/);
  });
});

describe("section 49 reads all three", () => {
  const runSection49 = (json: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "vd49-w4b-"));
    try {
      mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
      writeFileSync(join(dir, "scripts", "deploy-ledger.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(json))});\n`);
      const body = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/49-deploy-ledger.sh"), "utf8");
      return execFileSync("bash", ["-c", body], { cwd: dir, encoding: "utf8", timeout: 30_000 }).split("\n").filter(Boolean);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const base = { head: "abc", checkout: { refusal: null }, toDeploy: [], unreachable: [], unbumped: [], sharedOnly: [], noMarker: [], migrations: { pending: [], hold: [] }, phases: { errors: [] }, late: [], liveAhead: [], rows: [] };

  it("a releasable hold is a FAIL naming what to do; a waiting one is INFO", () => {
    const lines = runSection49({ ...base, migrations: { pending: [], hold: [HELD, "20261011104000_b.sql"] }, holds: [
      { file: HELD, until: "section 86 passes", releasable: true, conditions: [{ fn: "job-board", need: "job-board.2026-09-09.93", have: "job-board.2026-09-09.93", met: true }] },
      { file: "20261011104000_b.sql", until: "", releasable: false, conditions: [{ fn: "agent-mcp", need: "agent-mcp.2026-10-11.3", have: "agent-mcp.2026-10-09.71", met: false }] },
    ] });
    expect(lines.some((l) => /^FAIL  held migration 20261011103000_a_prune\.sql is RELEASABLE: every condition it names is live \(job-board answers job-board\.2026-09-09\.93\)\. Confirm what only you can check \(section 86 passes\)/.test(l)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => /^INFO  held until its conditions are live: 20261011104000_b\.sql \(agent-mcp answers agent-mcp\.2026-10-09\.71, wants agent-mcp\.2026-10-11\.3 or later\)/.test(l)), lines.join("\n")).toBe(true);
  });

  it("a declared rollback is a FAIL until production answers main's build; a stub-less migration production shows applied is INFO", () => {
    const lines = runSection49({ ...base,
      toDeploy: [{ fn: "a", want: "a.2026-10-11.2", have: "a.2026-10-11.3", state: "deploy (rollback)", rollbackFrom: "a.2026-10-11.3" }],
      migrations: { pending: ["20261011100000_x.sql"], hold: [], unproven: [{ file: "20261011100000_x.sql", why: "get_cron_health lists no active nightly-x" }], appliedByBehaviour: [{ file: "20261008125000_digests.sql", jobs: ["send-search-digest"] }] },
    });
    expect(lines).toContain("FAIL  a answers a.2026-10-11.3; main carries a.2026-10-11.2 (a declared rollback: deploy main's build)");
    expect(lines).toContain("FAIL  migration not applied: 20261011100000_x.sql (its behaviour proof: get_cron_health lists no active nightly-x)");
    expect(lines).toContain("INFO  applied by behaviour, no stub: 20261008125000_digests.sql (get_cron_health lists send-search-digest active)");
  });

  it("positive control: nothing to deploy, nothing pending, no hold, and section 49 passes", () => {
    const lines = runSection49({ ...base, rows: [{ fn: "c", want: "c.1", have: "c.1", state: "live" }], holds: [] });
    expect(lines.filter((l) => l.startsWith("PASS"))).toHaveLength(2);
    expect(lines.some((l) => l.startsWith("FAIL")), lines.join("\n")).toBe(false);
  });
});
