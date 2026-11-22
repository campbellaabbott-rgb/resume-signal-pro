// @vitest-environment node
/**
 * TWO IDS SENT AS ONE COMMA-SEPARATED STRING ARE CHECKED AS TWO (lane
 * fix/1121-connector-errors, item 12).
 *
 * Live: check_jobs_open {ids: "greenhouse:anthropic:5471118008,
 * greenhouse:mongodb:8398670"} answered checked 1 and closed [the whole
 * string], telling a person two live postings were gone. The
 * apply_to_my_shortlist prompt hands the model exactly such a string.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";
import { splitIds } from "../../supabase/functions/agent-mcp/tool-args.ts";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const A = "greenhouse:anthropic:5471118008";
const B = "greenhouse:mongodb:8398670";
const isId = (s: string) => /^[a-z]+:[^:\s,]+:[^\s,]+$/.test(s);

describe("the splitter", () => {
  it("a comma string, a new-line string and a JSON-array string are two ids; one id stays one", () => {
    expect(splitIds(`${A}, ${B}`, isId)).toEqual([A, B]);
    expect(splitIds(`${A}\n${B}`, isId)).toEqual([A, B]);
    expect(splitIds(JSON.stringify([A, B]), isId)).toEqual([A, B]);
    expect(splitIds(A, isId)).toEqual([A]);
  });
  it("a string with a piece that is no id stays one entry, never broken", () => {
    expect(splitIds(`${A}, not an id`, isId)).toEqual([`${A}, not an id`]);
    expect(splitIds(["", A, null], isId)).toEqual([A]);
  });
});

describe("check_jobs_open through the connector", () => {
  let m: KeylessMcp;
  beforeEach(async () => {
    m = await bootKeylessMcp();
    m.board = (b) => {
      const ids = (b.ids ?? []) as string[];
      return new Response(JSON.stringify({ open: ids.filter((x) => x === A || x === B), closed: [], unknown: [] , checked: ids.length }), { status: 200 });
    };
  }, 120_000);
  it("asks the board about two ids and answers checked 2, neither closed", async () => {
    const r = await m.call({ ids: `${A}, ${B}` }, { name: "check_jobs_open" });
    expect(r.isError).toBe(false);
    const sent = m.boardCalls.flatMap((b) => (b.ids ?? []) as string[]);
    expect(sent).toEqual(expect.arrayContaining([A, B]));
    expect(sent).not.toContain(`${A}, ${B}`);
    const body = JSON.parse(r.text) as { checked?: number; closed?: string[] };
    expect(body.checked).toBe(2);
    expect(body.closed ?? []).not.toContain(`${A}, ${B}`);
  });
  it("get_jobs reads the comma string as two ids", async () => {
    await m.call({ ids: `${A},${B}` }, { name: "get_jobs" });
    // get_jobs reads each id's detail on its own.
    const sent = m.boardCalls.flatMap((b) => (b.ids ?? (b.id ? [b.id] : [])) as string[]);
    expect(sent).toEqual(expect.arrayContaining([A, B]));
  });
});
