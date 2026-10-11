// @vitest-environment node
/**
 * THE WORKER'S LOCKFILE IS ONE `npm ci` ACCEPTS.
 *
 * On 2026-08-24 two Lovable commits moved worker/package.json's @types/node to
 * ^26 and updated worker/bun.lock, which nothing here installs from, but not
 * worker/package-lock.json, which everything here installs from. From then on
 * `npm ci` in worker/ refused ("lock file's @types/node@22.20.1 does not
 * satisfy ..."). CI hid it behind `npm ci || npm install`; the weekly bot-wall
 * sweep has no fallback and failed every scheduled run (L12-07), so the
 * vendor-wall series it exists to keep recorded nothing.
 *
 * This runs the same refusal npm runs: `npm ci --dry-run --offline` on a copy
 * of the two files. A dry run installs nothing and needs no network for a
 * lockfile that agrees with its package.json; one that disagrees is refused
 * with the EUSAGE CI and the sweep saw.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WORKER = resolve(__dirname, "../../worker");

describe("the worker's package.json and package-lock.json agree", () => {
  it("npm ci accepts them as they are committed", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "worker-lock-"));
    try {
      copyFileSync(join(WORKER, "package.json"), join(dir, "package.json"));
      copyFileSync(join(WORKER, "package-lock.json"), join(dir, "package-lock.json"));
      let out = "";
      let code = 0;
      try {
        out = execFileSync("npm", ["ci", "--dry-run", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: dir, encoding: "utf8", stdio: "pipe" });
      } catch (e) {
        const err = e as { status?: number; stderr?: string; stdout?: string };
        code = err.status ?? 1;
        out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      }
      const why = out.split("\n").filter((l) => /EUSAGE|does not satisfy|Missing:|Invalid:/.test(l)).join("\n");
      expect(code, `npm ci refused worker/package-lock.json -- regenerate it with \`npm install --package-lock-only\` in worker/:\n${why || out.slice(0, 600)}`).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
