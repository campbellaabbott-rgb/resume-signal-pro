/**
 * THE CONNECTOR SAID USAJOBS WAS WITHHELD BY OUR CHOICE, NOT BY ITS TERMS
 * (USAJOBS-COPY-1), AND SINCE OD16 IT HANDS THE FEED ON.
 *
 * The connector's refusal and the /agents note once said the U.S. federal job
 * feed's terms forbid redistributing it. The USAJOBS API terms, read on
 * 2026-11-16 and 2026-11-18 at developer.usajobs.gov/guides/terms-of-service,
 * say Public Data "may be copied, stored, reformatted, adapted, analyzed,
 * published, redistributed" and that prior OPM approval is not required.
 * USAJOBS-COPY-1 made the words say "withheld by our own choice"; OD16 (owner
 * 2026-11-18: yes) ended the choice. The connector now hands on every federal
 * row whose who-may-apply statement is stored, with OPM's notice, and withholds
 * only SmartRecruiters.
 *
 * INVERTED ON PURPOSE: this file used to pin usajobs inside both withheld
 * lists. It now pins it outside them, and keeps the old guard's point: no
 * sentence says a feed's terms forbid what they permit.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MCP_WITHHELD_NOTE, MCP_WITHHELD_SOURCES } from "../config/mcp-tools";

const MCP = readFileSync(resolve(__dirname, "../../supabase/functions/agent-mcp/index.ts"), "utf8");
const reasonOf = (src: string) => /const NO_REDISTRIBUTION_REASON =\s*"([^"]+)";/.exec(src)?.[1] ?? "";
const listOf = (src: string) => {
  const m = /const NO_REDISTRIBUTION_SOURCES = \[([^\]]*)\] as const;/.exec(src);
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
};
/** What the connector said before OD16: the federal feed withheld by our choice. */
const PRE_OD16 = 'const NO_REDISTRIBUTION_SOURCES = ["usajobs", "smartrecruiters"] as const;\n' +
  'const NO_REDISTRIBUTION_REASON =\n  "Two hiring systems are shown on resumebooster.work but not handed on by this connector: the U.S. federal job feed, which we choose not to redistribute for now, and SmartRecruiters, withheld until SmartRecruiters (SAP) permits it.";';

/** The connector's words, judged: SmartRecruiters alone withheld, nothing said to forbid. */
function judge(src: string): string[] {
  const out: string[] = [];
  const reason = reasonOf(src);
  if (!reason) out.push("NO_REDISTRIBUTION_REASON is no longer a literal");
  if (/forbid/i.test(reason)) out.push("the refusal says a feed's terms forbid it");
  if (/federal|usajobs/i.test(reason)) out.push("the refusal still names the federal feed as withheld");
  if (!/SmartRecruiters, withheld until SmartRecruiters \(SAP\) permits it/.test(reason)) out.push("the refusal no longer names SmartRecruiters and why");
  if (JSON.stringify(listOf(src)) !== JSON.stringify(["smartrecruiters"])) out.push(`the list is ${JSON.stringify(listOf(src))}`);
  return out;
}

describe("the connector hands the federal feed on and never said its terms forbid it", () => {
  it("the connector's refusal names SmartRecruiters alone, and nothing it says forbids", () => {
    expect(judge(MCP)).toEqual([]);
  });

  it("the /agents note says the federal feed is handed on with OPM's notice once who may apply is stored", () => {
    expect(MCP_WITHHELD_NOTE).not.toMatch(/forbid/i);
    expect(MCP_WITHHELD_NOTE).not.toMatch(/choose not to redistribute/);
    expect(MCP_WITHHELD_NOTE).toMatch(/U\.S\. federal announcements are handed on once the agency's statement of who may apply is stored/);
    expect(MCP_WITHHELD_NOTE).toMatch(/OPM/);
  });

  it("the feed is withheld on neither side, and SmartRecruiters on both", () => {
    expect(listOf(MCP)).toEqual(["smartrecruiters"]);
    expect([...MCP_WITHHELD_SOURCES]).toEqual(["smartrecruiters"]);
  });

  it("TEETH: the connector's words from before OD16 fail the judge on the list and on the federal reason", () => {
    const old = judge(PRE_OD16);
    expect(old).toContain("the refusal still names the federal feed as withheld");
    expect(old).toContain('the list is ["usajobs","smartrecruiters"]');
    // ... and a refusal that said the terms forbid it fails for that too.
    expect(judge(PRE_OD16.replace("which we choose not to redistribute for now", "whose terms of use forbid redistributing it"))).toContain("the refusal says a feed's terms forbid it");
  });
});
