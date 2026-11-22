// @vitest-environment node
/**
 * THE UPLOAD FITS UNDER THE TRIGGER BEFORE IT MERGES (job-board .103 review, 2026-11-18).
 *
 * Lovable uploads job-board with every _shared module it may import, and refuses an upload over about
 * 4.5 MB of raw source; then the old build keeps serving while the deploy note says the new one is live.
 * The program keeps job-board/** plus _shared/** at or under a trigger of 4,440,000 bytes (the guard is
 * 4,450,000), measured the way the deploy notes and the reservation state it: git ls-tree -r -l over the
 * committed tree. Until this file the only check was the ROOM line of the board-103 verify section, which
 * runs only when someone runs the section, so the suite and the pre-push hook passed a commit over both.
 *
 * It measures HEAD (what the push uploads) and the working copy of the same tracked files (so an edit
 * fails before it is committed). CI checks out one commit deep, which still holds HEAD's whole tree.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const DIRS = ["supabase/functions/job-board", "supabase/functions/_shared"];
const UPLOAD_TRIGGER = 4_440_000;
const UPLOAD_GUARD = 4_450_000;

/** The pre-push hook runs the suite with GIT_DIR and friends set; git here reads the checkout it sits in. */
const git = (...args: string[]) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return execFileSync("git", args, { cwd: ROOT, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
};

/** Sum of the blob sizes git ls-tree -r -l prints (its fourth column), the deploy notes' tally. */
function tallyOfLsTree(out: string): number {
  let n = 0;
  for (const line of out.split("\n")) {
    if (!line) continue;
    const m = /^\d+ blob [0-9a-f]+\s+(\d+)\t/.exec(line);
    if (!m) throw new Error(`git ls-tree printed a line this tally cannot read: ${line}`);
    n += Number(m[1]);
  }
  return n;
}

/** null when the tally fits; otherwise what is wrong, naming the bound it crossed. */
function overTheTrigger(tally: number, trigger = UPLOAD_TRIGGER, guard = UPLOAD_GUARD): string | null {
  if (!(tally > 0)) return `no tally: ${tally}`;
  if (tally > guard) return `${tally} bytes is over the ${guard} guard: Lovable refuses the upload`;
  if (tally > trigger) return `${tally} bytes is over the ${trigger} trigger (${guard - tally} under the guard): a room step comes first`;
  return null;
}

describe("job-board/** + _shared/** stays under the upload trigger", () => {
  it("at HEAD, as git ls-tree -r -l counts it", () => {
    const tally = tallyOfLsTree(git("ls-tree", "-r", "-l", "HEAD", "--", ...DIRS));
    expect(tally, "HEAD carries no job-board source").toBeGreaterThan(1_000_000);
    expect(overTheTrigger(tally), `HEAD's tally is ${tally}`).toBeNull();
  });

  it("in the working copy of the same tracked files, so an edit over it fails before it is committed", () => {
    const files = git("ls-files", "-z", "--", ...DIRS).split("\0").filter(Boolean);
    expect(files.length).toBeGreaterThan(50);
    const tally = files.reduce((n, f) => (existsSync(resolve(ROOT, f)) ? n + statSync(resolve(ROOT, f)).size : n), 0);
    expect(overTheTrigger(tally), `the working copy's tally is ${tally}`).toBeNull();
  });

  it("has teeth: the trigger, the guard and an unreadable line each fail", () => {
    expect(overTheTrigger(4_421_971)).toBeNull();
    expect(overTheTrigger(4_440_000)).toBeNull();
    expect(overTheTrigger(4_440_001)).toMatch(/over the 4440000 trigger \(9999 under the guard\)/);
    expect(overTheTrigger(4_450_001)).toMatch(/over the 4450000 guard/);
    expect(overTheTrigger(0)).toMatch(/no tally/);
    expect(tallyOfLsTree("100644 blob 0123abcd     120\ta.ts\n100644 blob 4567ef01    7\tb.ts\n")).toBe(127);
    expect(() => tallyOfLsTree("040000 tree 0123abcd       -\tdir\n")).toThrow(/cannot read/);
  });
});
