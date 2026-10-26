/**
 * D7 AT THE 500-PAGE CEILING (the round's review, 2026-10-24). The ceiling
 * rule picks the top 500 boards by open roles on every bake, so boards
 * indexable on the live site today rotated out at the cut: 24 company pages
 * with 198-307 open roles each would have gone noindex, and the owner's
 * decision D7 says no page indexable today loses its index without sign-off.
 * A board indexable today now keeps its place while its open roles are at
 * least half the cut's; the boards it displaces are the lowest-ranked NEW
 * ones (refusing a new page is what D7 allows), so the set never passes the
 * ceiling.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectLanders } from "../../scripts/prerender-pages.mjs";

const board = (token: string, open: number) => ({ token, name: token.toUpperCase(), open, count: open });
const openOf = (c: { open?: number }) => c.open ?? null;
const tokens = (rows: Array<{ token: string }>) => rows.map((r) => r.token);

describe("the ceiling keeps today's indexable boards near the cut", () => {
  // Ten boards, a ceiling of six: the cut falls at 300 open roles.
  const facet = [board("a", 900), board("b", 800), board("c", 700), board("d", 600), board("e", 320), board("f", 310), board("surge", 290), board("nbcu", 200), board("tiny", 120), board("g", 100)];

  it("without a list of today's pages it is the plain top six", () => {
    expect(tokens(selectLanders(facet, { openOf, max: 6 }))).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("keeps a board indexable today while its open roles are at least half the cut's, displacing the lowest new boards", () => {
    const keep = new Set(["surge", "nbcu", "tiny", "a"]);
    const chosen = tokens(selectLanders(facet, { openOf, max: 6, keep }));
    expect(chosen).toHaveLength(6);
    expect(chosen).toEqual(expect.arrayContaining(["a", "b", "c", "d", "surge", "nbcu"]));
    // 120 is under half of the cut's 310: it goes, as the ceiling rule says.
    expect(chosen).not.toContain("tiny");
    // The two new boards at the bottom of the top six made way.
    expect(chosen).not.toContain("e");
    expect(chosen).not.toContain("f");
  });

  it("never displaces another board indexable today, and never passes the ceiling", () => {
    const keep = new Set(["a", "b", "c", "d", "e", "f", "surge"]);
    const chosen = tokens(selectLanders(facet, { openOf, max: 6, keep }));
    expect(chosen).toHaveLength(6);
    expect(chosen).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("never displaces a board of an employer indexable today (its openings pool into that employer's page)", () => {
    const pwc = [board("a", 900), board("b", 800), board("pwc~wd3~global", 700), board("d", 600), board("e", 320), board("pwc~wd3~campus", 310), board("surge", 290), board("g", 100)]
      .map((c) => (c.token.startsWith("pwc") ? { ...c, name: "PwC" } : c));
    const chosen = tokens(selectLanders(pwc, { openOf, max: 6, keep: new Set(["pwc~wd3~global", "surge"]) }));
    expect(chosen).toContain("pwc~wd3~campus");
    expect(chosen).toContain("surge");
    expect(chosen).not.toContain("e");
  });

  it("keeps today's indexable board as its employer's canonical page when a sibling grows past it", () => {
    const pwc = [board("pwc~wd3~Global_Experienced_Careers", 1050), board("pwc~wd3~crm_experienced_careers_site", 808), board("pwc~wd3~global_campus_careers", 333)].map((c) => ({ ...c, name: "PwC" }));
    const plain = selectLanders(pwc, { openOf, max: 6 });
    expect(new Set(plain.map((c) => c.primary))).toEqual(new Set(["pwc~wd3~Global_Experienced_Careers"]));
    const sticky = selectLanders(pwc, { openOf, max: 6, keep: new Set(["pwc~wd3~crm_experienced_careers_site"]) });
    expect(new Set(sticky.map((c) => c.primary))).toEqual(new Set(["pwc~wd3~crm_experienced_careers_site"]));
    expect(new Set(sticky.map((c) => c.employerPrimary))).toEqual(new Set(["pwc~wd3~crm_experienced_careers_site"]));
  });

  it("is what the bake passes: today's indexable company pages", () => {
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/nameOf: \(c\) => bakeEmployerName\(c\.token, c\.name, NAME_PARTS\)\.name,\n\s*keep: INDEXABLE_TODAY_TOKENS,/);
    expect(bake).toMatch(/const INDEXABLE_TODAY_TOKENS = new Set\(\[\.\.\.INDEXABLE_TODAY\]\.map\(\(p\) => companyTokenOf\(p\)\)/);
  });
});
