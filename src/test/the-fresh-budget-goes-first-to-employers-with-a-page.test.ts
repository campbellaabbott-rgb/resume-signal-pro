/**
 * THE NEW-PAGE BUDGET GOES FIRST TO EMPLOYERS WITH A PAGE (B04, LINK-07, F09).
 *
 * On 2026-11-06 only 71 of the 491 live company pages shared a token with a
 * posting page, so 420 of them listed their own openings as plain text: the
 * budget went to the newest rows of the board whoever posted them.
 * freshPoolOrder (scripts/prerender-pages.mjs) puts the employers with a
 * company page this bake writes first, one candidate each a round, up to
 * three each, those with no carried posting page before those with some;
 * their pool rows come before their page's cached openings; then the rest of
 * the pool in its own order. It only orders: the budget and the ceiling stay.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { freshPoolOrder } from "../../scripts/prerender-pages.mjs";

type Cand = { id: string; token?: string; cached?: boolean };
const row = (id: string, token: string) => ({ id, token });
const ids = (out: Cand[]) => out.map((c) => c.id);

describe("freshPoolOrder", () => {
  const pool = [row("n1", "news"), row("a1", "acme"), row("b1", "beta"), row("a2", "acme"), row("a3", "acme"), row("a4", "acme"), row("n2", "news"), row("b2", "beta")];

  it("takes one row per employer with a page before a second from any one, then the rest of the pool in order", () => {
    const out = freshPoolOrder({ pool, pageTokens: ["acme", "beta"], hasPage: (t: string) => t === "acme" || t === "beta" });
    expect(ids(out)).toEqual(["a1", "b1", "a2", "b2", "a3", "n1", "a4", "n2"]);
  });

  it("takes at most perEmployer from one employer ahead of the pool", () => {
    const out = freshPoolOrder({ pool, pageTokens: ["acme"], hasPage: (t: string) => t === "acme", perEmployer: 2 });
    expect(ids(out).slice(0, 2)).toEqual(["a1", "a2"]);
    expect(ids(out).slice(2)).toEqual(["n1", "b1", "a3", "a4", "n2", "b2"]);
  });

  it("puts an employer with no carried posting page before one that has some", () => {
    const out = freshPoolOrder({ pool, pageTokens: ["acme", "beta"], hasPage: () => true, carriedTokens: new Set(["acme"]), perEmployer: 1 });
    expect(ids(out).slice(0, 3)).toEqual(["b1", "n1", "a1"]);
  });

  it("reaches an employer the newest pool missed through its page's cached openings, as ids to be read", () => {
    const out = freshPoolOrder({
      pool,
      pageTokens: ["gamma", "acme"],
      hasPage: (t: string) => t === "gamma" || t === "acme",
      cached: (t: string) => (t === "gamma" ? [{ id: "g1" }, { id: "g2" }] : t === "acme" ? [{ id: "a1" }, { id: "a9" }] : []),
      perEmployer: 2,
    });
    expect(out.slice(0, 4)).toEqual([{ id: "g1", token: "gamma", cached: true }, row("a1", "acme"), { id: "g2", token: "gamma", cached: true }, row("a2", "acme")]);
  });

  it("names every candidate once and drops none of the pool", () => {
    const out = freshPoolOrder({ pool, pageTokens: ["acme", "beta"], hasPage: () => true, cached: () => [{ id: "a1" }, { id: "x" }] });
    expect(new Set(ids(out)).size).toBe(out.length);
    for (const r of pool) expect(ids(out)).toContain(r.id);
  });

  it("with no employer page it is the pool unchanged", () => {
    expect(ids(freshPoolOrder({ pool, pageTokens: [], hasPage: () => false }))).toEqual(ids(pool));
  });
});

describe("the bake spends the budget in that order", () => {
  const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
  it("builds the order from the pool, this bake's employer pages and their cached openings", () => {
    expect(src).toMatch(/const freshOrder = freshPoolOrder\(\{\s*pool,\s*pageTokens: LANDERS\.map\(\(c\) => c\.token\),\s*hasPage: \(t\) => !!landerFor\(t\),/);
    expect(src).toMatch(/cached: \(t\) => \(landerOpeningsCache\[t\]/);
  });
  it("judges a cached opening after its detail read by the same rules as a pool row", () => {
    const loop = src.slice(src.indexOf("const freshOrder = freshPoolOrder"), src.indexOf("let freshWritten = 0;"));
    expect(loop).toMatch(/if \(cachedIds\.has\(c\.id\)\) \{[\s\S]*freshNameReason\(c\.job\)[\s\S]*takenBy\(c\.job\)[\s\S]*claimIdentity\(c\.job/);
    expect(loop).toMatch(/eligibleRow\(c\.job\)/);
  });
});
