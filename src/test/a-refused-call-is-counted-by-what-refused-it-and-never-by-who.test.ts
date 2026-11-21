// @vitest-environment node
/**
 * A REFUSED ARGUMENT IS COUNTED AS argument UNDER ITS TOOL, AND A TOOL THAT
 * DOES NOT EXIST IS COUNTED UNDER unknown, NEVER UNDER THE NAME THE CALLER
 * MADE UP (lane fix/1121-connector-errors, item 13).
 *
 * An argument refusal and a call to a tool that does not exist returned
 * before anything was counted, so mcp_calls_daily could not show the errors
 * people meet (findings section C: which errors users reported is not known
 * from here). The table still cannot say who: no argument text, no address.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

let m: KeylessMcp;
beforeEach(async () => {
  m = await bootKeylessMcp();
}, 120_000);
const counted = async () => {
  // The count is a background write: let it land.
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
  return m.rpcs.filter((x) => x.name === "mcp_count_call");
};

describe("refusals are counted by what refused them", () => {
  it("search_jobs {query: nurse, page: 2} is counted as argument under search_jobs, with nothing of what was sent", async () => {
    const r = await m.call({ query: "nurse", page: 2 });
    expect(r.isError).toBe(true);
    const c = await counted();
    expect(c).toHaveLength(1);
    expect(c[0].args).toMatchObject({ p_tool: "search_jobs", p_outcome: "argument" });
    expect(JSON.stringify(c[0].args)).not.toMatch(/page|nurse|203\.0\.113\.7/);
  });
  it("a tool that does not exist is counted under unknown", async () => {
    await m.rpc("tools/call", { name: "made_up_tool", arguments: {} });
    const c = await counted();
    expect(c).toHaveLength(1);
    expect(c[0].args).toMatchObject({ p_tool: "unknown", p_outcome: "argument" });
    expect(JSON.stringify(c[0].args)).not.toMatch(/made_up_tool/);
  });
  it("past sixty in one minute the refusal is still answered and nothing more is written", async () => {
    for (let i = 0; i < 61; i++) {
      const r = await m.call({ query: "nurse", page: 3 });
      expect(r.isError).toBe(true);
    }
    const c = await counted();
    expect(c.length).toBeLessThanOrEqual(60);
  });
});
