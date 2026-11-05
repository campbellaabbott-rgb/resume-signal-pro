// @vitest-environment node
/**
 * A MIGRATION THAT MAY BE RETRIED SAYS SO BESIDE ITS OWN LINE IN THE DEPLOY MESSAGE.
 *
 * The generated message tells the owner to stop at any failed migration unless
 * "a file whose own note below" says it may be applied again. A ledger `why` is
 * never printed, so before migrationOrder gained `note` a file could only earn
 * that sentence by being ordered behind something. 20261103161000 gives each
 * table two seconds and refuses to finish without a person's own tables, so a
 * busy minute on the live site stops the apply at a file that is safe to run
 * again, and its line said nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { migrationPhases } from "../../scripts/deploy-ledger.mjs";

const FILE = "20261103161000_a_connector_token_reaches_no_row.sql";
const ROWS = [{ fn: "job-board", want: "job-board.2026-09-09.101", have: "job-board.2026-09-09.100", state: "behind" }];
const phases = (entry: Record<string, unknown>) => migrationPhases([FILE], { migrationOrder: { "20261103161000": entry } }, ROWS);

describe("migrationOrder note", () => {
  it("a file with only a note goes before the functions with that note on its line", () => {
    const p = phases({ why: "not printed", note: "wait a minute and apply it again, unedited" });
    expect(p.errors).toEqual([]);
    expect(p.pre).toEqual([{ file: FILE, note: "wait a minute and apply it again, unedited" }]);
  });

  it("it stands beside the file's order, in every step", () => {
    const before = phases({ before: ["fn:job-board"], note: "N" });
    expect(before.pre[0].note).toBe("before job-board; N");
    const after = phases({ after: "fn:job-board@2026-09-09.101", note: "N" });
    expect(after.afterFunctions[0].note).toBe("once job-board answers job-board.2026-09-09.101 or later; N");
    const frontend = phases({ after: "frontend", note: "N" });
    expect(frontend.afterFrontend[0].note).toBe("after the frontend is published; N");
  });

  it("a note that is not a sentence is an error, never dropped", () => {
    expect(phases({ note: 5 }).errors).toEqual([expect.stringMatching(/migrationOrder 20261103161000: note must be a sentence/)]);
    expect(phases({ note: "" }).errors).toEqual([expect.stringMatching(/migrationOrder 20261103161000: note must be a sentence/)]);
  });

  it("20261103161000 carries the sentence the message asks for, and its why is no longer the only place it is said", () => {
    const ledger = JSON.parse(readFileSync(resolve(process.cwd(), "docs/deploy-ledger.json"), "utf8"));
    const note = String(ledger.migrationOrder["20261103161000"].note ?? "");
    expect(note).toMatch(/wait a minute and apply it again, unedited/);
    expect(note).toMatch(/any other error, stop and send it/);
  });
});
