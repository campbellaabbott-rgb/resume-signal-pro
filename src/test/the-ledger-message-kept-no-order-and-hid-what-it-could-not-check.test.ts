// @vitest-environment node
/**
 * THE LEDGER'S MESSAGE KEPT NO ORDER, HID WHAT IT COULD NOT CHECK, AND
 * TRUSTED ANY CHECKOUT (sweep S11, 2026-10-11).
 *
 * `node scripts/deploy-ledger.mjs --message` is the only allowed source of a
 * Lovable message (docs/DEPLOY-LEDGER.md §1). Three defects:
 *   - S11-049: it printed every migration, then every function, then the
 *     frontend. Wave 3 needs 131000 after the frontend (the live Account page
 *     writes back what it clears), 134200 after 131000, and 140000 before the
 *     new retry sweep (which calls the signature 140000 creates; the fixtures
 *     below still exercise an `after` rule). In wave 2 Lovable stopped
 *     for hours between steps. docs/deploy-ledger.json `migrationOrder` now
 *     carries `after` (and checked `before`) per stamp, and the message prints
 *     five steps.
 *   - S11-048: a preflight that failed at the network made the row
 *     "unreachable", and unreachable rows were dropped from the deploy list,
 *     the report and the message. With every fetch failing it listed 0 to
 *     deploy, exited 0, and section 49 printed PASS.
 *   - S11-127: it named the local HEAD and never looked at origin, so a stale
 *     checkout re-listed migrations Lovable had applied.
 *
 * The pure rules run on fixtures and on the real policy file; section 49 runs
 * in bash against a stub ledger. Nothing here reads the network or git.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8"));
let L: typeof import("../../scripts/deploy-ledger.mjs");
const realFetch = globalThis.fetch;
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
  L = await import("../../scripts/deploy-ledger.mjs");
  vi.unstubAllGlobals();
});
afterAll(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });

type Row = { fn: string; want: string | null; have: string | null; state: string };
const deploying = (fn: string, want: string, have = "x"): Row => ({ fn, want: `${fn}.${want}`, have: have === "x" ? `${fn}.2026-10-08.1` : have, state: "deploy" });
const live = (fn: string, build: string): Row => ({ fn, want: `${fn}.${build}`, have: `${fn}.${build}`, state: "live" });

const FIXTURE_ORDER = {
  migrationOrder: {
    _note: "ignored",
    "20261009130000": { before: ["fn:stripe-webhook"] },
    "20261009131000": { after: "frontend" },
    "20261009140000": { after: "fn:retry-failed-deliveries@2026-10-09.2" },
    "20261009144000": { before: ["fn:send-search-digest", "fn:send-agent-digest"] },
    "20261009150000": { after: "fn:already-live@2026-10-09.1" },
  },
};
const PENDING = [
  "20261009110000_a.sql",
  "20261009130000_notices.sql",
  "20261009131000_tracker.sql",
  "20261009140000_stuck.sql",
  "20261009144000_giveback.sql",
  "20261009150000_waits_for_a_live_build.sql",
];
const ROWS: Row[] = [
  deploying("stripe-webhook", "2026-10-09.4"),
  deploying("retry-failed-deliveries", "2026-10-09.3"),
  deploying("send-search-digest", "2026-10-09.3"),
  deploying("send-agent-digest", "2026-10-09.3"),
  live("already-live", "2026-10-09.1"),
];

describe("S11-049: a migration sits in the step its constraint names", () => {
  it("splits the pending list into before-functions, after-a-function and after-the-frontend", () => {
    const p = L.migrationPhases(PENDING, FIXTURE_ORDER, ROWS);
    expect(p.errors).toEqual([]);
    expect(p.pre.map((m) => m.file)).toEqual([
      "20261009110000_a.sql",
      "20261009130000_notices.sql",
      "20261009144000_giveback.sql",
      // its function already answers the build it waits for: nothing to wait for
      "20261009150000_waits_for_a_live_build.sql",
    ]);
    expect(p.afterFunctions.map((m) => m.file)).toEqual(["20261009140000_stuck.sql"]);
    expect(p.afterFrontend.map((m) => m.file)).toEqual(["20261009131000_tracker.sql"]);
    expect(p.pre.find((m) => m.file.startsWith("20261009144000"))?.note).toBe("before send-search-digest and send-agent-digest");
    // .3 is carried; the rule asked for .2 or later
    expect(p.afterFunctions[0].note).toBe("once retry-failed-deliveries answers retry-failed-deliveries.2026-10-09.2 or later");
  });

  it("prints five steps in the order Lovable must work them", () => {
    const p = L.migrationPhases(PENDING, FIXTURE_ORDER, ROWS);
    const msg = L.lovableMessage({ head: "abc12345", phases: p, toDeploy: ROWS.filter((r) => r.state === "deploy"), hold: ["20261009100300_held.sql"] });
    const at = (re: RegExp) => { const i = msg.findIndex((l) => re.test(l)); expect(i, `no line matches ${re}\n${msg.join("\n")}`).toBeGreaterThanOrEqual(0); return i; };
    expect(msg[0]).toMatch(/^Pull GitHub main at commit \*\*abc12345\*\*/);
    const steps = msg.filter((l) => /^\d+\. /.test(l)).map((l) => l.slice(0, 2));
    expect(steps).toEqual(["1.", "2.", "3.", "4.", "5."]);
    // 144000 before both digests deploy; 130000 before the webhook
    expect(at(/20261009144000_giveback/)).toBeLessThan(at(/- send-search-digest: /));
    expect(at(/20261009144000_giveback/)).toBeLessThan(at(/- send-agent-digest: /));
    expect(at(/20261009130000_notices/)).toBeLessThan(at(/- stripe-webhook: /));
    // 140000 after the sweep it waits for, and before the frontend
    expect(at(/20261009140000_stuck/)).toBeGreaterThan(at(/- retry-failed-deliveries: /));
    expect(at(/20261009140000_stuck/)).toBeLessThan(at(/^\d+\. Publish the frontend\./));
    // 131000 only after the frontend
    expect(at(/20261009131000_tracker/)).toBeGreaterThan(at(/^\d+\. Publish the frontend\./));
    expect(msg[at(/^\d+\. Publish the frontend\./) + 1]).toMatch(/^5\. Only once the frontend is published, apply this migration:/);
    expect(at(/Do NOT apply yet: 20261009100300_held\.sql/)).toBeLessThan(at(/^2\. Deploy these 4 edge functions/));
  });

  it("refuses a rule that can never be met, instead of guessing an order", () => {
    const bad = {
      migrationOrder: {
        "20261009140000": { after: "fn:retry-failed-deliveries@2026-10-10.1" }, // main carries .2026-10-09.3
        "20261009141000": { after: "fn:no-such-function@2026-10-09.1" },
        "20261009144000": { after: "frontend", before: ["fn:send-search-digest"] },
        "20261009145000": { after: "after the digests" },
        "2026100914": { after: "frontend" },
      },
    };
    const p = L.migrationPhases(["20261009140000_x.sql", "20261009141000_y.sql", "20261009144000_z.sql", "20261009145000_w.sql"], bad, ROWS);
    expect(p.errors.join("\n")).toMatch(/20261009140000_x\.sql waits for retry-failed-deliveries\.2026-10-10\.1, but main carries retry-failed-deliveries\.2026-10-09\.3/);
    expect(p.errors.join("\n")).toMatch(/main has no function no-such-function/);
    expect(p.errors.join("\n")).toMatch(/20261009144000_z\.sql waits for the frontend, yet it must apply before send-search-digest/);
    expect(p.errors.join("\n")).toMatch(/after "after the digests" is neither "frontend" nor/);
    expect(p.errors.join("\n")).toMatch(/key "2026100914" is not a 14-digit migration stamp/);
  });

  it("a function whose live build could not be read still makes its migration wait", () => {
    const rows = [{ fn: "retry-failed-deliveries", want: "retry-failed-deliveries.2026-10-09.2", have: null, state: "unreachable" }];
    const p = L.migrationPhases(["20261009140000_stuck.sql"], FIXTURE_ORDER, rows);
    expect(p.afterFunctions.map((m) => m.file)).toEqual(["20261009140000_stuck.sql"]);
  });

  it("the real policy holds wave 3's constraints, and every rule can be met at this checkout", () => {
    const wave3 = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => /^20261009\d{6}_/.test(f)).sort();
    const fnDir = resolve(ROOT, "supabase/functions");
    const rows: Row[] = readdirSync(fnDir).filter((d) => d !== "_shared").flatMap((fn) => {
      let src = ""; try { src = readFileSync(join(fnDir, fn, "index.ts"), "utf8"); } catch { return []; }
      const want = L.buildOf(fn, src);
      return [{ fn, want, have: null, state: want ? "deploy (no live header)" : "no-marker" }];
    });
    const p = L.migrationPhases(wave3, POLICY, rows);
    expect(p.errors).toEqual([]);
    expect(p.afterFrontend.map((m) => m.file.slice(0, 14))).toContain("20261009131000");
    // 134200 re-creates the cap 131000 also re-creates, so it follows 131000
    // after the frontend; 140000 precedes the sweep that calls its new
    // signature (wave-3 fix round integration).
    const late = p.afterFrontend.map((m) => m.file.slice(0, 14));
    expect(late.indexOf("20261009134200")).toBeGreaterThan(late.indexOf("20261009131000"));
    expect(p.pre.find((m) => m.file.startsWith("20261009140000"))?.note).toMatch(/before retry-failed-deliveries/);
    const g = p.pre.find((m) => m.file.startsWith("20261009144000"));
    expect(g?.note).toMatch(/before send-search-digest and send-agent-digest/);
    expect(p.pre.find((m) => m.file.startsWith("20261009130000"))?.note).toMatch(/before stripe-webhook/);
    // every rule names a stamp that exists, so none is silently inert (any
    // wave's: wave 4 added rules for its own 20261011* migrations)
    const all = readdirSync(resolve(ROOT, "supabase/migrations")).filter((f) => /^\d{14}_/.test(f));
    const stamps = Object.keys(POLICY.migrationOrder).filter((k) => !k.startsWith("_"));
    for (const s of stamps) expect(all.some((f) => f.startsWith(s)), `${s} names no migration file`).toBe(true);
  });
});

describe("S11-048: a function the ledger could not check is a gap, never a pass", () => {
  it("a preflight that never answered is 'unreachable'; one without a header is to deploy", () => {
    expect(L.rowState("f.2026-10-09.2", undefined)).toBe("unreachable");
    expect(L.rowState("f.2026-10-09.2", null)).toBe("deploy (no live header)");
    expect(L.rowState("f.2026-10-09.2", "f.2026-10-09.1")).toBe("deploy");
    expect(L.rowState("f.2026-10-09.2", "f.2026-10-09.2")).toBe("live");
    expect(L.rowState(null, undefined)).toBe("no-marker");
  });

  it("tries a silent preflight once more before calling it unreachable", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; if (calls === 1) throw new Error("reset"); return new Response(null, { headers: { "x-fn-build": "job-board.2026-09-09.92" } }); });
    await expect(L.liveBuild("https://p.test", "job-board", { pauseMs: 0 })).resolves.toBe("job-board.2026-09-09.92");
    expect(calls).toBe(2);
    calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; throw new Error("offline"); });
    await expect(L.liveBuild("https://p.test", "job-board", { pauseMs: 0 })).resolves.toBeUndefined();
    expect(calls).toBe(2);
    vi.unstubAllGlobals();
  });

  it("the message heads itself with a STOP naming every function it could not check", () => {
    const p = L.migrationPhases([], {}, []);
    const msg = L.lovableMessage({ head: "abc", phases: p, unreachable: [{ fn: "job-board" }, { fn: "stripe-webhook" }] });
    expect(msg[2]).toMatch(/^STOP: could not check 2 function\(s\)/);
    expect(msg[2]).toMatch(/Re-run the deploy ledger before sending: job-board, stripe-webhook\./);
  });

  const runSection49 = (json: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "vd49-"));
    try {
      mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
      writeFileSync(join(dir, "scripts", "deploy-ledger.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(json))}); process.exitCode = 4;\n`);
      const body = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/49-deploy-ledger.sh"), "utf8");
      const out = execFileSync("bash", ["-c", body], { cwd: dir, encoding: "utf8", timeout: 30_000 });
      return out.split("\n").filter(Boolean);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const base = { head: "abc", checkout: { refusal: null }, toDeploy: [], unbumped: [], sharedOnly: [], noMarker: [], migrations: { pending: [], hold: [] }, phases: { errors: [] } };

  it("section 49 FAILs every unreachable function and prints no PASS for the functions", () => {
    const rows = ["job-board", "stripe-webhook"].map((fn) => ({ fn, want: `${fn}.2026-10-09.2`, have: null, state: "unreachable" }));
    const lines = runSection49({ ...base, rows, unreachable: rows });
    expect(lines.filter((l) => /^FAIL  (job-board|stripe-webhook): could not check/.test(l))).toHaveLength(2);
    expect(lines.some((l) => /^PASS  every function/.test(l)), lines.join("\n")).toBe(false);
  });

  it("positive control: with every function answering, section 49 still passes", () => {
    const rows = [{ fn: "job-board", want: "job-board.2026-09-09.92", have: "job-board.2026-09-09.92", state: "live" }];
    const lines = runSection49({ ...base, rows, unreachable: [] });
    expect(lines.some((l) => /^PASS  every function with a build marker answers the build main carries \(1 functions\)/.test(l)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => l.startsWith("FAIL"))).toBe(false);
  });

  it("section 49 FAILs a run from a checkout that is not GitHub main, and an order rule that cannot be met", () => {
    const lines = runSection49({ ...base, rows: [], unreachable: [], checkout: { refusal: "HEAD 1b7bfe53 is 3 commit(s) behind origin/main a3201ce7" }, phases: { errors: ["x waits for y"] } });
    expect(lines.some((l) => /^FAIL  the ledger ran from a checkout that is not GitHub main \(HEAD 1b7bfe53 is 3 commit/.test(l))).toBe(true);
    expect(lines.some((l) => /^FAIL  migration order rule cannot be met: x waits for y/.test(l))).toBe(true);
  });
});

describe("S11-127: a message comes only from a checkout that is GitHub main", () => {
  it("refuses a checkout behind, ahead of, or unable to fetch origin/main", () => {
    expect(L.checkoutRefusal({ head: "a3201ce7aa", originMain: "a3201ce7aa" })).toBeNull();
    expect(L.checkoutRefusal({ head: "503fff27bb", originMain: "a3201ce7aa", behind: 12 })).toBe("HEAD 503fff27 is 12 commit(s) behind origin/main a3201ce7");
    expect(L.checkoutRefusal({ head: "1b7bfe53cc", originMain: "a3201ce7aa", ahead: 249 })).toMatch(/249 commit\(s\) ahead of origin\/main/);
    expect(L.checkoutRefusal({ head: "x", originMain: "y", behind: 1, ahead: 2 })).toMatch(/1 commit\(s\) behind and 2 ahead of/);
    expect(L.checkoutRefusal({ head: "x", originMain: "x", fetched: false })).toMatch(/git fetch origin failed/);
  });

  // Review of S11-127: the inputs are read from the working tree, so a dirty
  // checkout at origin/main printed a sendable message naming main's commit
  // and listing an untracked migration main does not have.
  it("refuses a checkout at origin/main whose deploy inputs differ from its commit, and names them", () => {
    const r = L.checkoutRefusal({ head: "a3201ce7aa", originMain: "a3201ce7aa", dirty: ["supabase/migrations/20261012999999_an_untracked_file_nobody_committed.sql", "scripts/deploy-ledger.mjs"] });
    expect(r).toMatch(/2 deploy input\(s\) differ from that commit/);
    expect(r).toContain("supabase/migrations/20261012999999_an_untracked_file_nobody_committed.sql");
    expect(L.checkoutRefusal({ head: "a3201ce7aa", originMain: "a3201ce7aa", dirty: [] })).toBeNull();
  });

  it("the report reads the dirty paths from git status over every input the message is built from", () => {
    const src = readFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/execFileSync\("git", \["status", "--porcelain", "--untracked-files=all", "--", \.\.\.DEPLOY_INPUTS\]/);
    for (const p of ["supabase/functions", "supabase/migrations", "drizzle/migrations", "docs/deploy-ledger.json", "scripts/deploy-ledger.mjs"]) {
      expect(L.DEPLOY_INPUTS).toContain(p);
    }
    expect(src).toMatch(/checkoutRefusal\(\{ head: headFull, originMain, fetched, behind, ahead, dirty \}\)/);
  });

  it("a draft names itself and never says to pull main", () => {
    const msg = L.lovableMessage({ head: "1b7bfe53", draftOf: "wave3/integration", phases: L.migrationPhases([], {}, []) });
    expect(msg[0]).toMatch(/^DRAFT from wave3\/integration at 1b7bfe53: NOT a deploy message/);
    expect(msg.some((l) => /Pull GitHub main/.test(l))).toBe(false);
  });

  it("the report wires the refusal to --message (read from the script, since running it would fetch)", () => {
    const src = readFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), "utf8");
    expect(src).toMatch(/execFileSync\("git", \["fetch", "--quiet", "origin", "main"\]/);
    expect(src).toMatch(/args\.has\("--message"\) && refusal\) \{\s*console\.log\(`REFUSED: \$\{refusal\}/);
    expect(src).toMatch(/Staged-runner record: \$\{stubs\.count\} stubs, newest/);
  });
});
