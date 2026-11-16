// @vitest-environment node
/**
 * A KIT THE FACT CHECK REFUSED IS LOGGED AS COUNTS, NEVER THE RÉSUMÉ'S WORDS
 * (RC-S13-064).
 *
 * When a drafted kit stated a year the résumé does not, the function logged
 * the fact check's issues verbatim, and each issue quotes the person's real
 * employer or school ("Year 2011 on <employer>"). The logs keep the kinds and
 * their counts only. The refusal itself still goes back to the person.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WritingWorld, loadWriter, post, tokenFor, PRO_USER } from "./helpers/writing-harness";
import { KIT_POSTING, KIT_RESUME, inventedYearKit, kitReply } from "./helpers/kit-fixtures";
import type { EdgeHandler } from "./helpers/edge-harness";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 240_000 });

let kit: EdgeHandler;
let world: WritingWorld;
beforeAll(async () => {
  new WritingWorld().install();
  kit = await loadWriter("generate-apply-package");
}, 240_000);
beforeEach(() => {
  world = new WritingWorld();
  world.install();
});
afterEach(() => vi.restoreAllMocks());

function captureLogs(): () => string[] {
  const lines: string[] = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a) ?? String(a))).join(" "));
    });
  }
  return () => lines;
}

describe("a kit whose draft and regeneration both state a year the résumé lacks", () => {
  it("is refused, and no log line carries the employer's name; a count line is logged", async () => {
    const logs = captureLogs();
    world.reply = () => kitReply(inventedYearKit());
    const r = await post(kit, "generate-apply-package", { resumeText: KIT_RESUME, jobPostingText: KIT_POSTING }, tokenFor(PRO_USER));
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(world.ai.length).toBeGreaterThanOrEqual(2);
    const printed = logs();
    expect(printed.filter((l) => l.includes("Initech"))).toEqual([]);
    expect(printed.some((l) => /grounding rejected draft: \d+ issues?: year \d/.test(l))).toBe(true);
  });
});
