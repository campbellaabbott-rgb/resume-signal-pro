// @vitest-environment node
/**
 * AN EMPTY SEARCH NEVER CLAIMS A PAGE LIMIT (connect W1, BR-04 and BR-05).
 *
 * Live 2026-11-07: five of 31 keyless searches answered pageLimitReached
 * with "A keyless search pages to offset 200. Narrow it..." on page one, among
 * them {query:"enfermera", location:"Madrid"} at total 0 and
 * {query:"Pflegefachkraft", location:"Berlin"} at six rows: the board sends
 * nextOffset 400 beside hasMore:false, and the check read it as a page past
 * the keyless depth. An exhausted search now carries no nextOffset and no
 * page limit.
 *
 * And a page whose every row only mentions the words in its description
 * ("marketing" in Austin: page two was a drywaller, a news photographer, an
 * endpoint engineer) now says so in matchNote; the board's relatedUnavailable
 * is passed on.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bootKeylessMcp, type KeylessMcp } from "./helpers/keyless-mcp";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const answer = (body: Record<string, unknown>) => () => new Response(JSON.stringify(body), { status: 200 });

describe("a page limit is claimed only when there is a next page", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);

  it("hasMore false with a nextOffset past the keyless depth: no nextOffset, no page limit", async () => {
    mcp.board = answer({ jobs: [], total: 0, hasMore: false, nextOffset: 400 });
    const out = JSON.parse((await mcp.call({ query: "basket weaver", offset: 0 })).text);
    expect(out.hasMore).toBe(false);
    expect(out.nextOffset).toBeUndefined();
    expect(out.pageLimitReached).toBeUndefined();
    expect(out.pageLimitNote).toBeUndefined();
  });

  it("hasMore false inside the keyless depth: the nextOffset that names no page is dropped too", async () => {
    mcp.board = answer({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Basket Weaver" }], total: 1, hasMore: false, nextOffset: 20 });
    const out = JSON.parse((await mcp.call({ query: "basket weaver" })).text);
    expect(out.nextOffset).toBeUndefined();
    expect(out.pageLimitReached).toBeUndefined();
  });

  it("hasMore true past the keyless depth still names the limit", async () => {
    mcp.board = answer({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 900, hasMore: true, nextOffset: 210 });
    const out = JSON.parse((await mcp.call({ query: "nurse", offset: 190 })).text);
    expect(out.pageLimitReached).toBe(true);
    expect(out.nextOffset).toBeUndefined();
  });

  it("hasMore true inside the keyless depth keeps the next page", async () => {
    mcp.board = answer({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 900, hasMore: true, nextOffset: 20 });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.nextOffset).toBe(20);
    expect(out.pageLimitReached).toBeUndefined();
  });
});

describe("a page of description-only matches says so", () => {
  let mcp: KeylessMcp;
  beforeAll(async () => { mcp = await bootKeylessMcp(); }, 120_000);

  it("every row a description match: matchNote says no title matched", async () => {
    mcp.board = answer({
      jobs: [
        { id: "greenhouse:acme:1", source: "greenhouse", title: "Drywall Installer", matchScope: "description" },
        { id: "greenhouse:acme:2", source: "greenhouse", title: "Painter", matchScope: "description" },
      ],
      total: 0, relatedTotal: 40, hasMore: false,
    });
    const out = JSON.parse((await mcp.call({ query: "marketing" })).text);
    expect(out.matchNote).toMatch(/No posting's title matches these words/);
    expect(out.relatedTotal).toBe(40);
  });

  it("a page with one title match carries no matchNote", async () => {
    mcp.board = answer({
      jobs: [
        { id: "greenhouse:acme:1", source: "greenhouse", title: "Marketing Manager" },
        { id: "greenhouse:acme:2", source: "greenhouse", title: "Painter", matchScope: "description" },
      ],
      total: 1, relatedTotal: 1, hasMore: false,
    });
    const out = JSON.parse((await mcp.call({ query: "marketing" })).text);
    expect(out.matchNote).toBeUndefined();
  });

  it("the board's relatedUnavailable reaches the caller", async () => {
    mcp.board = answer({ jobs: [{ id: "greenhouse:acme:1", source: "greenhouse", title: "Nurse" }], total: 1, relatedUnavailable: true, hasMore: false });
    const out = JSON.parse((await mcp.call({ query: "nurse" })).text);
    expect(out.relatedUnavailable).toBe(true);
  });
});
