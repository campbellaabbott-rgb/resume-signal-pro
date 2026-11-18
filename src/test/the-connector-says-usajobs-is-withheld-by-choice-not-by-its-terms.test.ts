/**
 * THE CONNECTOR SAYS USAJOBS IS WITHHELD BY OUR CHOICE, NOT BY ITS TERMS
 * (USAJOBS-COPY-1).
 *
 * The connector's refusal and the /agents note said the U.S. federal job
 * feed's terms forbid redistributing it. The USAJOBS API terms, read on
 * 2026-11-16 at developer.usajobs.gov/guides/terms-of-service, say Public
 * Data "may be copied, stored, reformatted, adapted, analyzed, published,
 * redistributed" and that prior OPM approval is not required. The feed is
 * still withheld (handing it on is the owner's decision, OD16), so the words
 * now say it is withheld by our own choice for now, and never that its terms
 * forbid it. ("Redistribute" stays: the guard on the refusal wants its reason named.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_WITHHELD_NOTE, MCP_WITHHELD_SOURCES } from "../config/mcp-tools";

const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const reason = /const NO_REDISTRIBUTION_REASON =\s*"([^"]+)";/.exec(MCP)?.[1] ?? "";

describe("the federal feed is withheld, and said to be withheld by choice", () => {
  it("the connector's refusal never says the feed's terms forbid it", () => {
    expect(reason, "NO_REDISTRIBUTION_REASON is no longer a literal").not.toBe("");
    expect(reason).not.toMatch(/forbid/i);
    expect(reason).toMatch(/the U\.S\. federal job feed, which we choose not to redistribute for now/);
  });

  it("the /agents note says the same", () => {
    expect(MCP_WITHHELD_NOTE).not.toMatch(/forbid/i);
    expect(MCP_WITHHELD_NOTE).toMatch(/the U\.S\. federal job feed, which we choose not to redistribute for now/);
  });

  it("and the feed is still withheld on both sides", () => {
    expect(MCP).toMatch(/const NO_REDISTRIBUTION_SOURCES = \["usajobs", "smartrecruiters"\] as const;/);
    expect(MCP_WITHHELD_SOURCES).toContain("usajobs");
  });
});
