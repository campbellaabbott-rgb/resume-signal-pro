/**
 * FIT_RESUME SAYS THE RULE ITS GATE APPLIES (wave 4 round 2 review, agents
 * lens: the claim drift fit-gate.ts's own header describes).
 *
 * WHAT WAS WRONG. fit_resume's tool description read "Free on any key: 25
 * scorings a day", but the rule moved into _shared/fit-gate.ts, which refuses
 * a key that is neither confirmed nor on a proven account. An agent holding
 * such a key read "free on any key" and was then refused.
 *
 * WHAT HOLDS NOW. The description names a confirmed key (with where it comes
 * from) or a proven account, and the gate it describes runs here: an
 * unconfirmed key on an unproven account is refused as "unconfirmed", a
 * confirmed key or a proven account is open.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fitGate } from "../../supabase/functions/_shared/fit-gate";

const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const tool = MCP.slice(MCP.indexOf('name: "fit_resume"'), MCP.indexOf('name: "board_stats"'));

describe("the description and the gate say one rule", () => {
  it("the description names a confirmed key or a proven account, never any key", () => {
    expect(tool).not.toMatch(/Free on any key/);
    expect(tool).toMatch(/Free on a confirmed key \(one from \$\{MINT_URL\}\) or on an account that has proven its mailbox/);
    expect(MCP).toMatch(/const MINT_URL = "https:\/\/resumebooster\.work\/data-api";/);
  });

  it("the gate refuses the key the old words promised, and opens the two the new words name", () => {
    const base = { userId: null, used: 0 };
    expect(fitGate({ paid: false, plan: false, standing: { ...base, confirmed: false, proven: false } })).toMatchObject({ open: false, reason: "unconfirmed" });
    expect(fitGate({ paid: false, plan: false, standing: { ...base, confirmed: true, proven: false } })).toMatchObject({ open: true, basis: "free" });
    expect(fitGate({ paid: false, plan: false, standing: { ...base, userId: "u", confirmed: false, proven: true } })).toMatchObject({ open: true, basis: "free" });
  });
});
