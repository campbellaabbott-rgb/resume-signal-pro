/**
 * THE DISK ALARM WAS HARD-CODED TO A PLAN THE PROJECT IS NOT ON.
 *
 * scan-heartbeat's two disk checks divided measured bytes by a literal
 * 8 * 1024^3. The disk was widened to 12GB, and the endpoint went on reporting
 * "database at 90% of the 8GB plan" — degraded — about headroom that actually
 * stood at 65%. An alarm that fires about a limit that no longer exists
 * teaches people to ignore it, and out-of-disk is the one failure mode that
 * takes every feature down at once; that alarm has to stay believable.
 *
 * The plan size is OPERATOR STATE now: meta row `plan_disk_gb`, seeded 12 by
 * 20260827220000, read once per heartbeat run with a fallback of 8 (a fresh
 * environment alarms early rather than never) and a 1..512 sanity clamp (a
 * typo must not disable the alarm). The next resize is a one-row UPDATE.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HB = readFileSync(
  resolve(__dirname, "../../supabase/functions/scan-heartbeat/index.ts"), "utf8");
/** Comments stripped — the incident note quotes the old literal. */
const CODE = HB.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const MIG = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260827220000_the_monitor_alarmed_about_a_limit_that_no_longer_exists.sql"), "utf8");

describe("the disk plan size is state, not a constant", () => {
  it("no disk check divides by a hard-coded plan size any more", () => {
    expect(CODE, "a literal plan size is back — it will be wrong at the next resize")
      .not.toMatch(/8 \* 1024 \*\* 3|8 \* 1024 \* 1024 \* 1024/);
    expect(CODE, "no check reads the plan row").toMatch(/eq\('k', 'plan_disk_gb'\)/);
  });

  it("both checks use the shared reader — two limits would drift apart", () => {
    const calls = CODE.match(/await planDiskGb\(\)/g) ?? [];
    expect(calls.length, "expected the storage check AND the disk check to ask the same source").toBe(2);
  });

  it("a missing or absurd row cannot disable the alarm", () => {
    // Fallback 8 alarms early on a fresh environment; the clamp stops a typo
    // (0, or 1200) from making usedPct permanently ~0.
    expect(CODE).toMatch(/gb >= 1 && gb <= 512 \? gb : 8/);
    expect(CODE).toMatch(/catch \{ val = 8; \}/);
  });

  it("the seed matches the real tier and documents the resize procedure", () => {
    expect(MIG).toMatch(/'plan_disk_gb', '\{"gb": 12\}'/);
    expect(MIG, "the next operator needs the UPDATE statement, not archaeology")
      .toMatch(/UPDATE job_board_meta SET v = '\{"gb": 16\}'/);
    expect(MIG).toMatch(/ON CONFLICT \(k\) DO UPDATE/);
  });

  it("the messages name the plan they measured against", () => {
    // "90% of the 8GB plan" was believed BECAUSE it named a number. The number
    // it names must now be the live one.
    expect(CODE).toMatch(/\$\{usedPct\}% of the \$\{planGb\}GB plan/);
    expect(CODE).not.toMatch(/of the 8GB plan/);
  });
});
