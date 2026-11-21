// @vitest-environment node
//
// Node, not jsdom: section 49 runs in bash through child_process.
/**
 * A MIGRATION LOVABLE'S AGENT REFUSES WAS LISTED AS ONE OF LOVABLE'S STEPS
 * (OI-47b).
 *
 * On 2026-11-06 Lovable's agent refused two migrations that read the vault
 * ("Agent access to secrets is not allowed") and the deploy stopped part-way:
 * the ledger had listed both as ordinary steps of the message. They left the
 * message only because someone wrote them into neverApply by hand, and the
 * next file that reads the vault would have been listed again.
 *
 * Now every pending or held file whose text reads the vault (comments count,
 * since the agent refuses on the words) is an OWNER STEP: it is taken out of
 * the Lovable steps, one line before step 1 tells the owner to run it in the
 * SQL editor before sending, and the ledger's JSON lists it under
 * ownerSteps. Its place is a decision, so a file with no migrationOrder entry,
 * or one that waits for a later step, stops the message (exit 6). Section 49
 * FAILs an owner step not yet run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
let L: typeof import("../../scripts/deploy-ledger.mjs");
const realFetch = globalThis.fetch;
beforeAll(async () => {
  vi.stubGlobal("fetch", async () => { throw new Error("the ledger reached the network on import"); });
  L = await import("../../scripts/deploy-ledger.mjs");
  vi.unstubAllGlobals();
});
afterAll(() => { globalThis.fetch = realFetch; vi.unstubAllGlobals(); });

const X = "20261201100000_a_cron_reads_its_key.sql";
const Y = "20261201110000_an_ordinary_table.sql";
const Z = "20261201120000_a_note_about_the_store.sql";
const TEXTS: Record<string, string> = {
  [X]: "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'k';\n",
  [Y]: "CREATE TABLE IF NOT EXISTS public.t (id int);\n",
  [Z]: "-- reads vault.decrypted_secrets once the owner has made the key\nSELECT 1;\n",
};
const sqlOf = (f: string) => TEXTS[f] ?? "";
type Row = { fn: string; want: string | null; have: string | null; state: string };
const ROWS: Row[] = [
  { fn: "mail-watch", want: "mail-watch.2026-12-01.1", have: "mail-watch.2026-11-12.1", state: "deploy" },
  { fn: "job-board", want: "job-board.2026-09-09.102", have: "job-board.2026-09-09.102", state: "live" },
];

describe("which files are owner steps", () => {
  it("a file that reads the vault is one, in its code or only in a comment; an ordinary file is not", () => {
    expect(L.ownerStepMigrations([Y, Z, X], sqlOf)).toEqual([X, Z]);
  });

  it("the two files the agent refused on 2026-11-06 are both selected by their real text", () => {
    const dir = resolve(ROOT, "supabase/migrations");
    const refused = readdirSync(dir).filter((f) => /^(20261103120000|20261103221000)_/.test(f));
    expect(refused).toHaveLength(2);
    expect(L.ownerStepMigrations(refused, (f: string) => readFileSync(join(dir, f), "utf8"))).toEqual(refused.sort());
  });
});

describe("the message's plan: owner steps first, in no Lovable step", () => {
  const policy = { migrationOrder: { "20261201100000": { before: ["fn:mail-watch", "fn:job-board"] }, "20261201120000": { before: [] } } };

  it("takes each owner step out of the Lovable steps and notes the functions it precedes that this message deploys", () => {
    const plan = L.messagePlan({ pending: [X, Y, Z], hold: [], policy, rows: ROWS, sqlOf });
    expect(plan.phases.errors).toEqual([]);
    expect(plan.ownerSteps).toEqual([{ file: X, note: "before mail-watch", held: false }, { file: Z, note: "", held: false }]);
    expect(plan.phases.pre.map((m) => m.file)).toEqual([Y]);
  });

  it("the message says OWNER FIRST before step 1, and the owner's files are in no numbered step", () => {
    const plan = L.messagePlan({ pending: [X, Y, Z], hold: [], policy, rows: ROWS, sqlOf });
    const msg = L.lovableMessage({ head: "abc12345", phases: plan.phases, toDeploy: [ROWS[0]], ownerSteps: plan.ownerSteps });
    const owner = msg.findIndex((l) => l.startsWith("OWNER FIRST"));
    const first = msg.findIndex((l) => /^1\. /.test(l));
    expect(owner, msg.join("\n")).toBeGreaterThan(-1);
    expect(owner).toBeLessThan(first);
    expect(msg[owner]).toContain(`1. ${X} (before mail-watch)`);
    expect(msg[owner]).toContain(`2. ${Z}`);
    expect(msg[owner]).toMatch(/not a step for Lovable/);
    expect(msg[owner]).toMatch(/SQL editor/);
    expect(msg[owner]).toMatch(/appliedOutsideDrizzle/);
    const steps = msg.filter((l) => /^\s*\d+\. /.test(l));
    for (const f of [X, Z]) expect(steps.some((l) => l.includes(f)), `${f} sits in a Lovable step`).toBe(false);
    expect(steps.some((l) => l.includes(Y))).toBe(true);
  });

  it("the message line never says the word the agent refuses", () => {
    const plan = L.messagePlan({ pending: [X], hold: [], policy, rows: ROWS, sqlOf });
    const line = L.lovableMessage({ head: "abc", phases: plan.phases, ownerSteps: plan.ownerSteps }).find((l) => l.startsWith("OWNER FIRST")) ?? "";
    expect(line.replace(X, "")).not.toMatch(/vault|secret|decrypt/i);
  });

  it("with no owner step the message is unchanged: no OWNER line", () => {
    const plan = L.messagePlan({ pending: [Y], hold: [], policy, rows: ROWS, sqlOf });
    expect(plan.ownerSteps).toEqual([]);
    expect(L.lovableMessage({ head: "abc", phases: plan.phases, ownerSteps: plan.ownerSteps }).some((l) => /OWNER/.test(l))).toBe(false);
  });

  it("an owner step with no order rule, or one that waits for a later step, stops the message", () => {
    const none = L.messagePlan({ pending: [X], hold: [], policy: { migrationOrder: {} }, rows: ROWS, sqlOf });
    expect(none.phases.errors.join("\n")).toMatch(/20261201100000_a_cron_reads_its_key\.sql reads the vault.*no migrationOrder entry/);
    const after = L.messagePlan({ pending: [X], hold: [], policy: { migrationOrder: { "20261201100000": { after: "frontend" } } }, rows: ROWS, sqlOf });
    expect(after.phases.errors.join("\n")).toMatch(/waits for frontend, a step that comes after the owner's/);
    const W = "20261201090000_an_earlier_table.sql";
    const behind = L.messagePlan({ pending: [W, X], hold: [], policy: { migrationOrder: { "20261201100000": { afterMigrations: ["20261201090000"] } } }, rows: ROWS, sqlOf });
    expect(behind.phases.errors, "the only error is the owner step's").toHaveLength(1);
    expect(behind.phases.errors[0]).toMatch(/must apply after 20261201090000_an_earlier_table\.sql, which Lovable applies in this message/);
    const fine = L.messagePlan({ pending: [X], hold: [], policy, rows: ROWS, sqlOf });
    expect(fine.phases.errors, "positive control").toEqual([]);
  });

  it("a held one stays held: listed as held, with no OWNER line", () => {
    const plan = L.messagePlan({ pending: [Y], hold: [X], policy, rows: ROWS, sqlOf });
    expect(plan.ownerSteps).toEqual([{ file: X, note: "before mail-watch", held: true }]);
    expect(L.lovableMessage({ head: "abc", phases: plan.phases, hold: [X], ownerSteps: plan.ownerSteps }).some((l) => /^OWNER FIRST/.test(l))).toBe(false);
  });
});

describe("the report wires the plan (read from the script, since running it would reach production)", () => {
  const src = readFileSync(resolve(ROOT, "scripts/deploy-ledger.mjs"), "utf8");
  it("builds the phases through messagePlan, prints ownerSteps in the JSON and hands them to the message", () => {
    expect(src).toMatch(/const \{ phases, ownerSteps \} = messagePlan\(\{ pending: mig\.pending, hold: mig\.hold, policy: POLICY, rows, onDisk, sqlOf \}\);/);
    expect(src).not.toMatch(/const phases = migrationPhases\(mig\.pending/);
    expect(src).toMatch(/JSON\.stringify\(\{[^\n]*\bownerSteps,/);
    expect(src).toMatch(/lovableMessage\(\{[^\n]*\bownerSteps \}\)\) console\.log\(l\);/);
  });
});

describe("section 49 FAILs an owner step not yet run", () => {
  const runSection49 = (json: unknown) => {
    const dir = mkdtempSync(join(tmpdir(), "vd49-owner-"));
    try {
      mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
      writeFileSync(join(dir, "scripts", "deploy-ledger.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(json))});\n`);
      const body = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/49-deploy-ledger.sh"), "utf8");
      return execFileSync("bash", ["-c", body], { cwd: dir, encoding: "utf8", timeout: 30_000 }).split("\n").filter(Boolean);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const base = { head: "abc", checkout: { refusal: null }, toDeploy: [], unbumped: [], sharedOnly: [], noMarker: [], rows: [], unreachable: [], phases: { errors: [] } };

  it("names the owner step and the SQL editor, and does not list it again as a Lovable migration", () => {
    const lines = runSection49({ ...base, migrations: { pending: [X, Y], hold: [] }, ownerSteps: [{ file: X, note: "before mail-watch", held: false }] });
    expect(lines.some((l) => l.startsWith(`FAIL  owner step not run: ${X} reads the vault`) && /SQL editor \(before mail-watch\)/.test(l)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => l === `FAIL  migration not applied: ${X}`), lines.join("\n")).toBe(false);
    expect(lines.some((l) => l === `FAIL  migration not applied: ${Y}`)).toBe(true);
  });

  it("a held owner step is INFO", () => {
    const lines = runSection49({ ...base, migrations: { pending: [], hold: [X] }, ownerSteps: [{ file: X, note: "", held: true }] });
    expect(lines.some((l) => l.startsWith("INFO  held, and an owner step once released") && l.endsWith(X)), lines.join("\n")).toBe(true);
    expect(lines.some((l) => l.startsWith("FAIL") && l.includes(X))).toBe(false);
  });
});
