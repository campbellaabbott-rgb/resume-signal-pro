// @vitest-environment node
/**
 * POSTEDAT SAYS WHOSE DATE IT IS (connect W3, BR-15; the W1 answer fields).
 *
 * Read 2026-11-07: tools/list serves postedAt as {type:'string'} with no
 * description (outputSchema descriptions are stripped to fit the listing),
 * and no tool description nor the guide said what postedAt is, so a model
 * could say "posted 3 days ago" without whose date it is, or read a missing
 * date as old. The guide every client reads now says postedAt is the
 * employer's own date and that its absence says nothing about age, and it
 * names the fields W1 added (matchNote, locationInterpreted, sponsorshipNote,
 * withheld, withheldNote, locationHint, and check_jobs_open's unknown).
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

describe("the guide says what the answers' dates and notes mean", () => {
  let mcp: KeylessMcp;
  let guide = "";
  beforeAll(async () => {
    mcp = await bootKeylessMcp();
    const r = await mcp.rpc("resources/read", { uri: "resumebooster://guide" }) as { result: { contents: Array<{ text: string }> } };
    guide = r.result.contents[0].text;
  }, 120_000);

  it("postedAt is the employer's date, not the board's, and its absence is not age", () => {
    const line = guide.split("\n").find((l) => l.includes("`postedAt`"))!;
    expect(line).toMatch(/employer's own hiring system/);
    expect(line).toMatch(/not when this board first saw it/);
    expect(line).toMatch(/does not make a posting old/);
  });

  it.each(["matchNote", "locationInterpreted", "sponsorshipNote", "withheldNote", "locationHint"])("%s is explained", (field) => {
    expect(guide).toContain(`\`${field}\``);
  });

  it("check_jobs_open's unknown list is named beside the not-a-job-id refusal", () => {
    const line = guide.split("\n").find((l) => l.includes("That is not a job id from this board."))!;
    expect(line).toMatch(/`unknown`, never as closed/);
  });

  it("the board's posting page is named as a job id", () => {
    expect(guide).toMatch(/resumebooster\.work\/jobs\/posting\/ page/);
  });
});
