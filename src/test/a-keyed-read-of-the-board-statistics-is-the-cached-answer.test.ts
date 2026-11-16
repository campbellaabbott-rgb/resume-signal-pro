// @vitest-environment node
/**
 * A KEYED READ OF THE BOARD STATISTICS IS THE CACHED ANSWER (S14X-133).
 *
 * board_stats, and the keyless read of resumebooster://board/stats, answer a
 * five-minute cache with one shared board read in flight. The keyed
 * resources/read of the same resource called the board live every time, a
 * facet count over the whole board per read, so three reads a second apart
 * gave three different cachedAt stamps. It now reads the same cache.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const ALLOWED = {
  is_allowed: true, deny_reason: "", api_key_id: "key-1", key_tier: "free",
  rate_limit: 60, rate_used: 1, quota_limit: 1000, quota_used: 1,
};
let mcp: KeylessMcp;
beforeEach(async () => {
  mcp = await bootKeylessMcp();
  mcp.answers.api_key_check = { data: ALLOWED, error: null };
  mcp.board = () => new Response(JSON.stringify({ jobs: [], total: 0, totalAllCompanies: 1234, trackedTotal: 2000, companiesOpenCount: 50, categories: { Nursing: 1 }, refreshedAt: "2026-11-15T00:00:00Z" }), { status: 200 });
});

const readStats = async () => {
  const body = await mcp.rpc("resources/read", { uri: "resumebooster://board/stats" }, { authorization: "Bearer rb_live_harness_key" });
  const text = (body.result as { contents?: Array<{ text?: string }> } | undefined)?.contents?.[0]?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
};
const facetReads = () => mcp.boardCalls.filter((b) => b.includeFacets === true).length;

describe("a keyed resources/read of board/stats", () => {
  it("makes one board read for two reads, and both carry the same cachedAt", async () => {
    const a = await readStats();
    await new Promise((r) => setTimeout(r, 5));
    const b = await readStats();
    expect(a.servablePostings).toBe(1234);
    expect(facetReads()).toBe(1);
    expect(b.cachedAt).toBe(a.cachedAt);
  });

  it("shares its cache with the board_stats tool", async () => {
    await mcp.call({}, { name: "board_stats" });
    await readStats();
    expect(facetReads()).toBe(1);
  });
});
