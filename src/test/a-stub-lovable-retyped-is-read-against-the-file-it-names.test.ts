// @vitest-environment node
/**
 * A STUB LOVABLE RETYPED IS READ AGAINST THE FILE IT NAMES
 * (the upkeep hotfix review, 2026-11-07; scripts/deploy-ledger.mjs
 * retypedStubs, section 49).
 *
 * Lovable's agent retypes migration SQL; it does not pipe the file. Its stub
 * of 20261103100000 (drizzle 0208, 2026-11-06) carries a condition twice that
 * the repo file has once. The ledger matched the stub by its name and read
 * the file as applied, and only a hand diff found the difference. Now:
 *   - each stub the ledger matches by stamped name or title is compared with
 *     its repo file, comments and whitespace aside (Lovable drops comments);
 *   - a stub that only runs SQL staged under a name holds no text and is not
 *     compared, nor is a file older than the drizzle baseline;
 *   - section 49 FAILs a difference nobody has read and prints one read under
 *     retypedRead as INFO;
 *   - on this tree the comparison finds exactly what the hand diff found.
 * No network, no git.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as L from "../../scripts/deploy-ledger.mjs";

const ROOT = resolve(__dirname, "../..");
const POLICY = JSON.parse(readFileSync(resolve(ROOT, "docs/deploy-ledger.json"), "utf8")) as Record<string, unknown> & { retypedRead?: Record<string, string> };
const AFFILIATE = "20261103100000_an_affiliate_buying_under_an_alias_of_their_own_address_earns_nothing.sql";

const FILE = "-- A header the stub drops.\nSELECT 1\n  FROM t\n WHERE a = 1 -- trailing note\n   AND b <> 2;\n";
const pair = (stubSql: string, file = "20261107100000_x.sql") => ({ file, stub: `0220_${file}`, repoSql: FILE, stubSql });

describe("a retyped stub is compared with its file, comments and whitespace aside", () => {
  it("a stub that dropped the comments and reflowed the lines is the same text", () => {
    expect(L.sqlText(FILE)).toBe("SELECT 1 FROM t WHERE a = 1 AND b <> 2;");
    expect(L.retypedStubs([pair("SELECT 1 FROM t WHERE a = 1\nAND b <> 2;")], {})).toEqual([]);
  });

  it("a stub with a line written twice is another text, unread until retypedRead names its stamp", () => {
    const twice = pair("SELECT 1 FROM t WHERE a = 1 AND b <> 2 AND b <> 2;");
    const [found] = L.retypedStubs([twice], {});
    expect(found).toMatchObject({ file: "20261107100000_x.sql", stub: "0220_20261107100000_x.sql", read: null });
    expect(found.repo).toContain("AND b <> 2;");
    expect(found.ran).toContain("AND b <> 2 AND b <> 2;");
    expect(L.retypedStubs([twice], { retypedRead: { "20261107100000": "the same condition twice" } })[0].read).toBe("the same condition twice");
  });

  it("a stub that only runs SQL staged under a name holds no text of its own and is not compared", () => {
    const exec = "SELECT public._mig_exec((SELECT sql FROM public._mig_staging WHERE name = '20261107100000_x'));";
    expect(L.retypedStubs([pair(exec)], {})).toEqual([]);
  });
});

describe("on this tree", () => {
  it("finds exactly what the hand diff of 2026-11-06 found, and it is read", () => {
    const retyped = L.migrations(POLICY).retyped;
    expect(retyped.map((r: { file: string }) => r.file)).toEqual([AFFILIATE]);
    expect(retyped[0].repo).toContain("<> p_stripe_session_id AND d.created_at <");
    expect(retyped[0].ran).toContain("<> p_stripe_session_id AND d.stripe_session_id <> p_stripe_session_id AND d.created_at <");
    expect(retyped[0].read).toMatch(/twice .* selects the same rows/);
  });

  it("positive control: without its entry, that stub is unread", () => {
    const { retypedRead: _read, ...unread } = POLICY;
    expect(L.migrations(unread).retyped.map((r: { read: string | null }) => r.read)).toEqual([null]);
  });
});

describe("section 49 reads it", () => {
  const run49 = (retyped: unknown[]) => {
    const dir = mkdtempSync(join(tmpdir(), "vd49-retyped-"));
    try {
      mkdirSync(join(dir, "scripts", "verify-deploy.d"), { recursive: true });
      const json = { head: "abc", checkout: { refusal: null }, toDeploy: [], unreachable: [], unbumped: [], sharedOnly: [], noMarker: [], migrations: { pending: [], hold: [], retyped }, phases: { errors: [] }, holds: [], late: [], liveAhead: [], rows: [{ fn: "c", want: "c.1", have: "c.1", state: "live" }] };
      writeFileSync(join(dir, "scripts", "deploy-ledger.mjs"), `process.stdout.write(${JSON.stringify(JSON.stringify(json))});\n`);
      const body = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/49-deploy-ledger.sh"), "utf8");
      return execFileSync("bash", ["-c", body], { cwd: dir, encoding: "utf8", timeout: 30_000 }).split("\n").filter(Boolean);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const drift = { file: "20261107100000_x.sql", stub: "0220_20261107100000_x.sql", repo: "AND b <> 2;", ran: "AND b <> 2 AND b <> 2;" };

  it("an unread difference is a FAIL naming the stub, both texts and where to record it", () => {
    const lines = run49([{ ...drift, read: null }]);
    expect(lines.filter((l) => l.startsWith("FAIL"))).toEqual([
      "FAIL  Lovable's stub 0220_20261107100000_x.sql ran another text than 20261107100000_x.sql (comments and whitespace aside): the repo reads ...AND b <> 2;... where the stub reads ...AND b <> 2 AND b <> 2;... Diff the two, and record what the difference means under retypedRead in docs/deploy-ledger.json",
    ]);
  });

  it("a read one is INFO with what reading it found, and no FAIL", () => {
    const lines = run49([{ ...drift, read: "the same condition twice" }]);
    expect(lines).toContain("INFO  Lovable's stub 0220_20261107100000_x.sql ran another text than 20261107100000_x.sql, read: the same condition twice");
    expect(lines.some((l) => l.startsWith("FAIL")), lines.join("\n")).toBe(false);
  });
});
