/**
 * THE D7 COMPANY PAGES STAY INDEXABLE PAST THE CEILING (live verify run 1
 * after the 2026-10-31 deploy, section 99zz N4).
 *
 * The owner's decision of 2026-10-25 on the pages the name gate listed under
 * D7 (docs/company-profiles/name-gate-dry-run.md, table 1, and the deploy
 * note's TRUSTED PAGES paragraph): they stay indexed and become trusted, by
 * fixing the name and the country underneath. Four of them are company pages:
 * Honeywell Aerospace (icfcjb~ocs~CX_1), LCS (eexs~us2~CX_3001), Reyes
 * Beverage Group (talent.reyesholdings.com) and Martin Brower
 * (jobportal.martinbrower.com), the second member of the Reyes feed.
 *
 * THE DEFECT. The fix underneath moved the boards' counts: once each Reyes
 * board read only its own brand, Martin Brower fell from the shared feed's
 * ~498 open roles to 107 (rank 1,384 of the 12,145 boards with 8 or more;
 * the 500-page ceiling's cut was 299). selectLanders keeps a board indexable
 * today only while it has half the cut's roles, so Martin Brower was not
 * chosen, the carry path wrote its page "noindex, follow" with no facts
 * (live, Googlebot UA, 2026-10-31), and the live sitemap dropped it. The next
 * bake no longer counts it as indexable today at all (the live sitemap is
 * what "today" reads). LCS is next: job-board .96 reads the "All" pool site
 * once, and its own board now holds 13 of the 604 roles its page printed.
 *
 * THE FIX. The four pages are a named list the ceiling never rotates out
 * (D7_TRUSTED_COMPANY_TOKENS, selectLanders `pin`). A pinned board still has
 * to be in the facet with the minimum open roles and still meets the name
 * gate, the duplicate rule and the thin rule (landerRobots): only the
 * ceiling's rotation is lifted, never the gate ("never by loosening the
 * gate", the owner's words). The set never passes the ceiling: a pinned board
 * displaces the lowest-ranked new board, never one indexable today.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { D7_TRUSTED_COMPANY_TOKENS, landerRobots, selectLanders } from "../../scripts/prerender-pages.mjs";

const ROOT = resolve(__dirname, "../..");
type Board = { token: string; name: string; open: number; count: number };
const board = (token: string, open: number, name = token.toUpperCase()): Board => ({ token, name, open, count: open });
const openOf = (c: { open?: number }) => c.open ?? null;
const tokens = (rows: Array<{ token: string }>) => rows.map((r) => r.token);

// The live facet's shape on 2026-10-31 (get_job_board_facets, 23:37Z): a
// ceiling of 500 whose cut is 299, and the four D7 boards at their measured
// open counts: 498 new boards from 900 down, Honeywell Aerospace among them
// at 644, then the cut's own board at 299 (the 500th), then the long tail.
const MB = board("jobportal.martinbrower.com", 107, "Martin Brower");
const REYES = board("talent.reyesholdings.com", 269, "Reyes Beverage Group");
const HONEYWELL = board("icfcjb~ocs~CX_1", 644, "Aerospace");
const LCS = board("eexs~us2~CX_3001", 13, "All");
const filler = Array.from({ length: 498 }, (_, i) => board(`new-${String(i).padStart(3, "0")}`, 900 - i));
const facet: Board[] = [...filler, board("utaustin~wd1~UTstaff", 299, "Utaustin"), ...Array.from({ length: 120 }, (_, i) => board(`tail-${i}`, 298 - i)), HONEYWELL, REYES, MB, LCS];
/** The four pages by name: every expectation below names them, so an empty or missing list cannot pass. */
const FOUR = ["icfcjb~ocs~CX_1", "eexs~us2~CX_3001", "talent.reyesholdings.com", "jobportal.martinbrower.com"];
const D7 = new Set<string>(D7_TRUSTED_COMPANY_TOKENS ?? []);

describe("the four D7 company pages are one named list", () => {
  it("names exactly the four company pages of the owner's D7 table, Martin Brower among them", () => {
    expect([...(D7_TRUSTED_COMPANY_TOKENS ?? [])].sort()).toEqual([...FOUR].sort());
  });

  it("is the list section 99zz judges as staying indexable (N4), so the bake and the verifier name the same pages", () => {
    const s = readFileSync(resolve(ROOT, "scripts/verify-deploy.d/99zz-trusted-pages.sh"), "utf8");
    const n4 = /for\(const \[k,path\] of (\[\[[^;]*?\]\])\)\{/.exec(s);
    expect(n4, "99zz's N4 loop").not.toBeNull();
    const paths = [...n4![1].matchAll(/"(\/jobs\/company\/[^"]+)"/g)].map((m) => m[1].replace(/^\/jobs\/company\//, "").replace(/\/+$/, ""));
    expect(paths.sort()).toEqual([...FOUR].sort());
    expect([...(D7_TRUSTED_COMPANY_TOKENS ?? [])].sort()).toEqual(paths);
  });
});

describe("main's ceiling rotated Martin Brower out (the defect, measured)", () => {
  it("without the pin, Martin Brower (107, under half of the 299 cut) is not chosen, even counted as indexable today", () => {
    const keep = new Set(["jobportal.martinbrower.com", "talent.reyesholdings.com", "icfcjb~ocs~CX_1", "eexs~us2~CX_3001"]);
    const chosen = tokens(selectLanders(facet, { openOf, max: 500, keep }));
    expect(chosen).toHaveLength(500);
    expect(chosen).not.toContain("jobportal.martinbrower.com");
    expect(chosen).not.toContain("eexs~us2~CX_3001");
    // Reyes Beverage Group (269) still clears half the cut, and Honeywell is in the plain top 500.
    expect(chosen).toEqual(expect.arrayContaining(["talent.reyesholdings.com", "icfcjb~ocs~CX_1"]));
  });
});

describe("the pin keeps the D7 pages through the ceiling, and nothing else changes", () => {
  it("chooses all four D7 boards, with or without today's sitemap naming them, and the set stays at the ceiling", () => {
    for (const keep of [null, new Set<string>(), new Set(["talent.reyesholdings.com", "icfcjb~ocs~CX_1"])]) {
      const chosen = tokens(selectLanders(facet, { openOf, max: 500, keep, pin: D7 }));
      expect(chosen).toHaveLength(500);
      expect(chosen).toEqual(expect.arrayContaining(FOUR));
    }
  });

  it("displaces the lowest-ranked new boards, never a board indexable today", () => {
    const keep = new Set(["new-497", "new-496"]);
    const chosen = tokens(selectLanders(facet, { openOf, max: 500, keep, pin: D7 }));
    expect(chosen).toHaveLength(500);
    expect(chosen).toEqual(expect.arrayContaining(["new-497", "new-496", ...FOUR]));
    // Reyes Beverage Group, Martin Brower and LCS are past the cut (Honeywell
    // is in the top 500): the three lowest boards that are not kept make way.
    expect(chosen).not.toContain("utaustin~wd1~UTstaff");
    expect(chosen).not.toContain("new-495");
    expect(chosen).not.toContain("new-494");
    expect(chosen).toContain("new-493");
  });

  it("is a no-op for a pinned board already in the top 500", () => {
    expect(tokens(selectLanders(facet, { openOf, max: 500, pin: new Set(["icfcjb~ocs~CX_1"]) })))
      .toEqual(tokens(selectLanders(facet, { openOf, max: 500 })));
  });

  it("does not lift the minimum: a pinned board under 8 open roles, or one the board no longer carries, gets no page", () => {
    const thin = facet.map((c) => (c.token === MB.token ? { ...c, open: 5, count: 5 } : c));
    expect(tokens(selectLanders(thin, { openOf, max: 500, pin: D7 }))).not.toContain(MB.token);
    const gone = facet.filter((c) => c.token !== MB.token);
    expect(tokens(selectLanders(gone, { openOf, max: 500, pin: D7 }))).not.toContain(MB.token);
  });

  it("keeps the pinned page its employer's canonical page when a sibling under the same name is larger", () => {
    const lcs = [board("eexs~us2~CX_3001", 13, "LCS"), board("eexs~us2~CX_11009", 60, "LCS")];
    const rows = selectLanders(lcs, { openOf, max: 500, pin: new Set(["eexs~us2~CX_3001"]) });
    expect(new Set(rows.map((c) => c.primary))).toEqual(new Set(["eexs~us2~CX_3001"]));
    // Without the pin the larger sibling would carry the canonical.
    expect(new Set(selectLanders(lcs, { openOf, max: 500 }).map((c) => c.primary))).toEqual(new Set(["eexs~us2~CX_11009"]));
  });

  it("a chosen Martin Brower page is indexable by the page rules, which the pin does not touch", () => {
    // Its own primary, a printable name, its listing answered with openings of its own.
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: true, ownContent: true })).toBeNull();
    // The rules still bite on a pinned page: a tenant-code name, a duplicate, or an answered listing with nothing of its own.
    expect(landerRobots({ isPrimary: true, unreadable: true, answered: true, ownContent: true })).toBe("noindex, follow");
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: true, ownContent: true, duplicate: true })).toBe("noindex, follow");
    expect(landerRobots({ isPrimary: true, unreadable: false, answered: true, ownContent: false })).toBe("noindex, follow");
  });
});

describe("the bake pins the list when it chooses its company pages", () => {
  const GEN = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
  it("imports D7_TRUSTED_COMPANY_TOKENS and passes it as `pin` to the bakeLanders call that sets LANDERS", () => {
    expect(GEN).toMatch(/import \{[^}]*\bD7_TRUSTED_COMPANY_TOKENS\b[^}]*\} from "\.\/prerender-pages\.mjs";/);
    const call = /const LANDERS = bakeLanders\([^;]*?\}\);/.exec(GEN);
    expect(call, "the LANDERS call").not.toBeNull();
    expect(call![0]).toMatch(/\bpin: new Set\(D7_TRUSTED_COMPANY_TOKENS\)/);
    expect(call![0]).toMatch(/\bkeep: INDEXABLE_TODAY_TOKENS\b/);
  });

  it("bakeLanders hands `pin` to selectLanders", async () => {
    const { bakeLanders } = await import("../../scripts/prerender-pages.mjs");
    const D = { boardName: (_t: string, n: string) => n, isCodeShapedName: () => false };
    const chosen = tokens(bakeLanders(facet, { D, openOf, pin: D7 }));
    expect(chosen).toEqual(expect.arrayContaining(FOUR));
    expect(chosen).toHaveLength(500);
  });
});
