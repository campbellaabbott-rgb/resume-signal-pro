// @vitest-environment node
/**
 * A CLAUDE CODE CALL REFUSED FOR THE MINUTE IS TOLD WHOSE MINUTE
 * (connect W3, APPLY-1107-09, wording only).
 *
 * Live 2026-11-07: a fifth keyless apply_myself call in one minute from a
 * person's own connection was refused "Too many keyless calls this minute for
 * reading application forms from outside Claude and ChatGPT (4 of 4)". Claude
 * Code calls from the person's own connection, so it counts in that share; a
 * Claude Code user read "outside Claude" and had no reason to think a key
 * would help. Claude Code is now named, with the free key, when its user agent
 * says Claude Code. Nothing is counted differently: which row the minute counts
 * on is the owner's economics decision of 2026-10-11 and a SQL change, not
 * this one.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { keylessClientOf, lookupBucket, spentRefusal } from "../../supabase/functions/agent-mcp/allowance";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const MINUTE = { allowed: false, refused_by: "minute", bucket_used: 3, bucket_cap: 200, share_used: 40, share_cap: 6000, overall_used: 900, overall_cap: 20000, minute_used: 15, minute_cap: 15 } as const;
const MINT = "https://resumebooster.work/agents#key";

describe("the refusal's words", () => {
  it("reads Claude Code from its user agent and nothing else", () => {
    expect(keylessClientOf("claude-code/2.0.31")).toBe("claude-code");
    expect(keylessClientOf("claude-cli/2.0.31 (external, cli)")).toBe("claude-code");
    expect(keylessClientOf("openai-mcp/1.0.0")).toBe("unknown");
    expect(keylessClientOf("Claude-User/1.0")).toBe("unknown");
    expect(keylessClientOf(null)).toBe("unknown");
  });

  it("a Claude Code call outside the platforms' networks is told it is Claude Code on its own connection, and that a free key lifts the minute", () => {
    const b = lookupBucket(null, "", "conn-hash");
    const [message, fix] = spentRefusal(MINUTE, b, "other", "the site", MINT, 1000, Date.UTC(2026, 10, 8, 12, 0, 30), "claude-code");
    expect(message).toMatch(/^Too many keyless calls this minute from Claude Code on your own connection \(15 of 15\)\. Nothing was counted for this call\.$/);
    expect(fix).toMatch(/A free key \(https:\/\/resumebooster\.work\/agents#key\) lifts this\./);
  });

  it("any other caller reads the words it always read", () => {
    const b = lookupBucket(null, "", "conn-hash");
    const [message, fix] = spentRefusal(MINUTE, b, "other", "the site", MINT, 1000, Date.UTC(2026, 10, 8, 12, 0, 30));
    expect(message).toMatch(/from outside Claude and ChatGPT \(15 of 15\)/);
    expect(fix).not.toMatch(/lifts this/);
    const claude = spentRefusal(MINUTE, lookupBucket("claude", "", ""), "claude", "the site", MINT, 1000, Date.UTC(2026, 10, 8, 12, 0, 30), "claude-code");
    expect(claude[0]).toMatch(/this minute from Claude \(15 of 15\)/);
  });
});

describe("the server reads the user agent for the refusal", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); mcp.meter = { ...MINUTE, refused_by: "minute" }; }, 120_000);

  it("a minute refusal to claude-code/2.0.31 names Claude Code", async () => {
    const res = await mcp.call({ query: "nurse" }, { ua: "claude-code/2.0.31" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/from Claude Code on your own connection/);
    expect(mcp.boardCalls).toEqual([]);
  });
});
