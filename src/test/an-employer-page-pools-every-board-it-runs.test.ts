/**
 * AN EMPLOYER PAGE POOLS EVERY BOARD IT RUNS (RC-S12-021, the bake half).
 *
 * The ceiling chooses boards one by one, so an employer's smaller board that
 * missed the cut was left out of the employer page's pooled count and named
 * no page in /landers.json: live on 2026-11-15 PwC's page pooled three boards
 * while pwc~wd3~US_Experienced_Careers sat in the companies facet, unpooled
 * and unmapped. A board below the cut that shares a chosen employer's group
 * key is now a pooled member: no page, so the ceiling still counts pages, but
 * counted on its employer's page and mapped there.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { employerBoardsOf, pooledMembersOf, selectLanders } from "../../scripts/prerender-pages.mjs";

type Row = { token: string; name: string; open?: number; count?: number };
const GLOBAL = "pwc~wd3~Global_Experienced_Careers";
const CRM = "pwc~wd3~crm_experienced_careers_site";
const CAMPUS = "pwc~wd3~Global_Campus_Careers";
const US = "pwc~wd3~US_Experienced_Careers";
/** Four boards of PwC's, and enough other employers that the fourth misses a cut of 6. */
const FACET: Row[] = [
  { token: GLOBAL, name: "PwC", open: 2119, count: 3254 },
  { token: CRM, name: "PwC", open: 900, count: 1000 },
  { token: CAMPUS, name: "PwC", open: 300, count: 320 },
  { token: "hilton~wd3~Careers", name: "Hilton", open: 3159, count: 3312 },
  { token: "aecom~wd5~External", name: "AECOM", open: 2229, count: 2874 },
  { token: "dollartree", name: "Dollar Tree", open: 5296, count: 5299 },
  { token: US, name: "PwC", open: 120, count: 130 },
  // The same name on another hiring system: a different employer, never pooled.
  { token: "pwc", name: "PwC", open: 60, count: 60 },
  // PwC's tenant under another name: not the page's employer by the bake's rule.
  { token: "pwc~wd3~Alumni", name: "PwC Alumni Network", open: 40, count: 40 },
  // A board of PwC's with nothing open has nothing to pool.
  { token: "pwc~wd3~Closed_Site", name: "PwC", open: 0, count: 12 },
];
const openOf = (c: Row) => (typeof c.open === "number" ? c.open : null);
const landers = () => selectLanders(FACET, { openOf, max: 6 });

describe("a board below the cut", () => {
  it("misses the cut on its own (the premise: the ceiling counts pages)", () => {
    const tokens = landers().map((c: { token: string }) => c.token);
    expect(tokens).toHaveLength(6);
    expect(tokens).toEqual(expect.arrayContaining([GLOBAL, CRM, CAMPUS]));
    expect(tokens).not.toContain(US);
  });

  it("is pooled into its employer's page, and nothing else is", () => {
    const L = landers();
    const members = pooledMembersOf(FACET, L, { openOf });
    expect(members.map((m: { token: string }) => m.token)).toEqual([US]);
    expect(members[0]).toMatchObject({ employerPrimary: GLOBAL, primary: GLOBAL, sameEmployer: true, open: 120, member: true });
  });

  it("is counted among the employer's boards, and the page count does not move", () => {
    const L = landers();
    const members = pooledMembersOf(FACET, L, { openOf });
    expect(employerBoardsOf(L, GLOBAL)).toHaveLength(3);
    const all = [...L, ...members];
    expect(employerBoardsOf(all, GLOBAL).sort()).toEqual([CAMPUS, CRM, GLOBAL, US].sort());
    const sum = employerBoardsOf(all, GLOBAL).map((t: string) => all.find((c: { token: string }) => c.token === t)!.open).reduce((a: number, b: number) => a + b, 0);
    expect(sum).toBe(2119 + 900 + 300 + 120);
    expect(L).toHaveLength(6);
  });

  it("follows the employer's own page when the name's page belongs to someone else", () => {
    // Acme's Workday tenant is the smaller employer under the name; its
    // below-cut board pools to Acme's own primary and inherits sameEmployer.
    const facet: Row[] = [
      { token: "acme-big", name: "Acme", open: 900 },
      { token: "acme~wd1~Main", name: "Acme", open: 300 },
      { token: "filler-a", name: "Filler A", open: 800 },
      { token: "acme~wd1~Small", name: "Acme", open: 20 },
    ];
    const L = selectLanders(facet, { openOf, max: 3 });
    const m = pooledMembersOf(facet, L, { openOf });
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ token: "acme~wd1~Small", employerPrimary: "acme~wd1~Main", primary: "acme-big", sameEmployer: false });
  });

  it("reads the same displayed name the ceiling grouped by", () => {
    const facet: Row[] = [
      { token: "chubb~wd1~External", name: "Chubb", open: 500 },
      { token: "filler-a", name: "Filler A", open: 800 },
      { token: "chubb~wd1~Other", name: "Chubb External", open: 30 },
    ];
    const displayName = (c: Row) => c.name.replace(/\s+External$/, "").trim();
    const L = selectLanders(facet, { openOf, displayName, max: 2 });
    expect(pooledMembersOf(facet, L, { openOf }).map((x: { token: string }) => x.token)).toEqual([]);
    expect(pooledMembersOf(facet, L, { openOf, displayName }).map((x: { token: string }) => x.token)).toEqual(["chubb~wd1~Other"]);
  });
});

describe("the bake", () => {
  const BAKE = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
  it("pools members into the count an employer page states", () => {
    const at = BAKE.indexOf("const pooledOpen = (c) => {");
    const body = BAKE.slice(at, BAKE.indexOf("};", at));
    expect(body).toContain("employerBoardsOf([...LANDERS, ...POOLED_MEMBERS], c.token)");
    expect(body).toContain("landerByToken.get(t) ?? memberByToken.get(t)");
  });
  it("maps members in /landers.json, and links them, through the one landerFor", () => {
    expect(BAKE).toContain("const landersManifest = Object.fromEntries([...LANDERS, ...POOLED_MEMBERS].map((c) => [c.token, landerFor(c.token)?.href ?? null]));");
    const at = BAKE.indexOf("const landerFor = (token) => {");
    expect(BAKE.slice(at, BAKE.indexOf("};", at))).toContain("if (member) return landerFor(member.employerPrimary);");
  });
  it("names members with the same name the ceiling grouped by", () => {
    const at = BAKE.indexOf("const POOLED_MEMBERS = pooledMembersOf(");
    const call = BAKE.slice(at, BAKE.indexOf("});", at));
    expect(call).toContain("displayName: (c) => bakeEmployerName(c.token, c.name, NAME_PARTS).name");
    const landersCall = BAKE.slice(BAKE.indexOf("const LANDERS = bakeLanders("), BAKE.indexOf("});", BAKE.indexOf("const LANDERS = bakeLanders(")));
    expect(landersCall).toContain("nameOf: (c) => bakeEmployerName(c.token, c.name, NAME_PARTS).name");
  });
});
