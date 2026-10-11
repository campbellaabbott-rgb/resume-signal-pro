import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import {
  LLMS_TXT_COMPANIES,
  bakeEmployerKey,
  bakeLanders,
  employerBoardsOf,
  employerPageOf,
  llmsTxtCompaniesCount,
  selectLanders,
} from "../../scripts/prerender-pages.mjs";
import { boardName, isCodeShapedName } from "@/lib/company-display";
import { employerKey } from "@/lib/employer-key";
import { CATALOG } from "./helpers/catalog";

/**
 * TWO EMPLOYERS SHARING A NAME ARE NOT ONE EMPLOYER'S BOARDS.
 *
 * The bake grouped company pages on the printed name alone
 * (scripts/prerender-pages.mjs selectLanders, "primaryByName"), so every board
 * printing "Accenture" was treated as one employer: the smaller page
 * canonicalised to the larger, the larger page pooled the smaller board's
 * openings as its own, and the smaller board's postings linked the larger
 * page as "All open roles at Accenture". Accenture's Workday tenant and a
 * Pinpoint board are two employers (company-profiles plan 2026-10-11, review
 * problem 2: 37 keys, 85 boards, are a plain slug merged with a Workday
 * tenant this way).
 *
 * Siblings now share the employer key (the layoff matcher's employer segment,
 * with the token's shape standing in for the source the facet does not carry)
 * AND the name. Two employers under one name still yield one indexable page
 * (the smaller canonicalises to the larger, so no two indexable pages share a
 * title), but neither pools the other's openings and neither is linked as the
 * other's page. Which page is indexable does not change, so the sitemap does
 * not move.
 */

describe("who is one employer, in the bake", () => {
  it("the matcher's segment: UKG client, the whole eu~ token, the tenant, the slug", () => {
    expect(bakeEmployerKey("recruiting~OLL1000OLLIE~355913c1")).toBe("ukg:recruiting~OLL1000OLLIE");
    expect(bakeEmployerKey("recruiting~OLL1000OLLIE~aaaa")).toBe(bakeEmployerKey("recruiting~OLL1000OLLIE~355913c1"));
    expect(bakeEmployerKey("recruiting2~OLL1000OLLIE~355913c1"), "two UKG pods are two hosts").not.toBe(bakeEmployerKey("recruiting~OLL1000OLLIE~355913c1"));
    expect(bakeEmployerKey("recruiting~TRO1001TROO~x"), "two UKG clients on one host").not.toBe(bakeEmployerKey("recruiting~OLL1000OLLIE~x"));
    expect(bakeEmployerKey("eu~lookers")).not.toBe(bakeEmployerKey("eu~rubyhotels"));
    expect(bakeEmployerKey("pwc~wd3~Advisory")).toBe(bakeEmployerKey("pwc~wd3~Tax"));
    expect(bakeEmployerKey("ejwl~us2~CX")).toBe(bakeEmployerKey("ejwl~us2~CX_1"));
    expect(bakeEmployerKey("a232a7a1-770b~9201585048116_2")).toBe(bakeEmployerKey("a232a7a1-770b~1684781626_2117"));
    expect(bakeEmployerKey("careers.aarp.org")).toBe("slug:careers.aarp.org");
  });

  it("over the whole catalogue it never joins two boards the site's employer key keeps apart", () => {
    // The bake cannot import src/lib/employer-key.ts (plain node on the hosted
    // builder) and the facet carries no source, so bakeEmployerKey reads the
    // token's shape. Held here against employerKey(source, token) over every
    // board exactly one hiring system carries (a board two carry shows no
    // employer facts at all): one bake key never spans two employer keys.
    const sourcesOf = new Map<string, Set<string>>();
    for (const e of CATALOG) {
      const s = sourcesOf.get(e.token) ?? new Set<string>();
      s.add(e.source);
      sourcesOf.set(e.token, s);
    }
    const single = [...sourcesOf].filter(([, s]) => s.size === 1).map(([t, s]) => [t, [...s][0]] as const);
    expect(single.length, "the catalogue reader found too few boards to judge").toBeGreaterThan(20_000);
    const spans = new Map<string, Set<string>>();
    for (const [token, source] of single) {
      const b = bakeEmployerKey(token);
      const k = spans.get(b) ?? new Set<string>();
      k.add(employerKey(source, token));
      spans.set(b, k);
    }
    const joined = [...spans].filter(([, k]) => k.size > 1).map(([b, k]) => `${b}: ${[...k].join(" + ")}`);
    expect(joined, "the bake would pool these different employers' boards").toEqual([]);
    // And it does pool where the key pools: one Workday tenant's career sites.
    const pooled = [...spans].filter(([b]) => b.startsWith("workday:")).length;
    const workdayBoards = single.filter(([, s]) => s === "workday").length;
    expect(pooled, "every Workday site became its own employer: the bake key stopped pooling").toBeLessThan(workdayBoards);
  });

  it("the merges the matcher's rule alone allows are refused: a plain slug is never a Workday tenant", () => {
    expect(bakeEmployerKey("blackstone"), "Blackstone Shooting Sports is not Blackstone Inc.").not.toBe(bakeEmployerKey("blackstone~wd1~Blackstone_Careers"));
    expect(bakeEmployerKey("accenture")).not.toBe(bakeEmployerKey("accenture~wd103~AccentureCareers"));
    expect(bakeEmployerKey("dupont")).not.toBe(bakeEmployerKey("dupont~wd5~Jobs"));
    expect(bakeEmployerKey("ejwl~us2~CX"), "an Oracle tenant is not a Workday tenant of the same name").not.toBe(bakeEmployerKey("ejwl~wd1~CX"));
  });
});

describe("siblings are one employer under one name", () => {
  const facet = [
    { token: "accenture~wd103~AccentureCareers", name: "Accenture", open: 5265 },
    { token: "accenture", name: "Accenture", open: 40 },
    { token: "pwc~wd3~crm_experienced_careers_site", name: "PwC", open: 1121 },
    { token: "pwc~wd3~global_campus", name: "PwC", open: 300 },
    { token: "ejwl~us2~CX", name: "Marriott", open: 13613 },
    { token: "ejwl~us2~CX_1", name: "Marriott", open: 200 },
    { token: "dominos", name: "Domino's", open: 21829 },
  ];
  const landers = selectLanders(facet, { openOf: (c: { open: number }) => c.open });
  const by = Object.fromEntries(landers.map((l: { token: string }) => [l.token, l])) as Record<string, { primary: string; employerPrimary: string; sameEmployer: boolean }>;

  it("one employer's boards canonicalise to its largest and pool into it", () => {
    expect(by["pwc~wd3~global_campus"].primary).toBe("pwc~wd3~crm_experienced_careers_site");
    expect(by["pwc~wd3~global_campus"].sameEmployer).toBe(true);
    expect(employerBoardsOf(landers, "pwc~wd3~crm_experienced_careers_site").sort()).toEqual(["pwc~wd3~crm_experienced_careers_site", "pwc~wd3~global_campus"]);
    expect(employerPageOf(landers, "pwc~wd3~global_campus")).toBe("pwc~wd3~crm_experienced_careers_site");
    expect(by["ejwl~us2~CX_1"].primary).toBe("ejwl~us2~CX");
    expect(employerBoardsOf(landers, "ejwl~us2~CX").sort()).toEqual(["ejwl~us2~CX", "ejwl~us2~CX_1"]);
  });

  it("a different employer under the same name still yields one indexable page, but pools nothing and is linked as nobody's", () => {
    // One indexable "Accenture Jobs" page, so no two indexable pages share a title.
    expect(by.accenture.primary).toBe("accenture~wd103~AccentureCareers");
    expect(by.accenture.sameEmployer, "the Pinpoint board is not the Workday tenant").toBe(false);
    expect(by.accenture.employerPrimary).toBe("accenture");
    // The Workday page pools only the Workday tenant's boards.
    expect(employerBoardsOf(landers, "accenture~wd103~AccentureCareers")).toEqual(["accenture~wd103~AccentureCareers"]);
    // The Pinpoint board's own page shows only its own (it is canonicalised away).
    expect(employerBoardsOf(landers, "accenture")).toEqual(["accenture"]);
    // Its postings link the live board filtered to it, not the other employer's page.
    expect(employerPageOf(landers, "accenture")).toBeNull();
    expect(employerPageOf(landers, "accenture~wd103~AccentureCareers")).toBe("accenture~wd103~AccentureCareers");
  });

  it("which page is indexable is exactly what the name-only grouping chose, so the sitemap does not move", () => {
    const size = (c: { open: number }) => c.open;
    const byName = new Map<string, { token: string; open: number }>();
    for (const c of facet) {
      const k = c.name.toLowerCase();
      const prev = byName.get(k);
      if (!prev || size(c) > size(prev)) byName.set(k, c);
    }
    for (const l of landers as Array<{ token: string; name: string; primary: string }>) {
      expect(l.primary, l.token).toBe(byName.get(l.name.toLowerCase())!.token);
    }
  });

  it("the bake pools and links through these two functions, not by the canonical alone", () => {
    const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    expect(bake).toMatch(/const tokens = employerBoardsOf\(LANDERS, c\.token\);/);
    expect(bake).toMatch(/const pageToken = employerPageOf\(LANDERS, token\);/);
    expect(bake, "the old name-only pooling is back").not.toMatch(/LANDERS\.filter\(\(x\) => x\.primary === c\.primary\)/);
  });
});

describe("the USAJOBS board is named USAJOBS on its page and in the A–Z, never after one agency", () => {
  it("bakeLanders names it by the board's own name, whatever agency the stored row carries", () => {
    const D = { boardName, isCodeShapedName };
    const landers = bakeLanders([
      { token: "usajobs", name: "Western Area Power Administration", open: 9474 },
      { token: "dominos", name: "Domino's", open: 21829 },
    ], { D, openOf: (c: { open: number }) => c.open });
    const usa = landers.find((l: { token: string }) => l.token === "usajobs") as { name: string; unreadable: boolean };
    expect(usa.name).toBe("USAJOBS");
    expect(usa.unreadable).toBe(false);
  });
});

describe("llms.txt says what /companies lists, counted by the bake that built it", () => {
  const committed = readFileSync(resolve(__dirname, "../../public/llms.txt"), "utf8");
  const line = committed.split("\n").find((l) => l.includes("](https://resumebooster.work/companies)")) ?? "";

  it("the committed line names no number it cannot refresh and promises no live count", () => {
    expect(line, "the /companies line is missing").not.toBe("");
    expect(line).toMatch(LLMS_TXT_COMPANIES);
    expect(line, "the A–Z prints counts measured at build, not live ones").not.toMatch(/live count/i);
    expect(line).toMatch(/measured when the index was built/);
    expect(line).not.toMatch(/every employer/i);
    expect(line.match(LLMS_TXT_COMPANIES)![0], "a committed number would go stale").not.toMatch(/\d/);
  });

  it("each bake restates the number of pages it made indexable, and drops a number it did not count", () => {
    const baked = llmsTxtCompaniesCount(committed, 471);
    expect(baked).toContain("The 471 employers this site gives a page of their own");
    expect(llmsTxtCompaniesCount(baked, 1204)).toContain("The 1,204 employers this site gives a page of their own");
    expect(llmsTxtCompaniesCount(baked, null), "a bake that counted none leaves no number standing").toContain("The employers this site gives a page of their own");
    expect(llmsTxtCompaniesCount(baked, null)).not.toMatch(/The [\d,]+ employers this site/);
  });

  it("the bake applies it with its own count, and warns when the line is gone", () => {
    const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    expect(bake).toMatch(/lt = llmsTxtCompaniesCount\(lt, COMPANY_PAGE_COUNT\);/);
    expect(bake).toMatch(/if \(!LLMS_TXT_COMPANIES\.test\(lt\)\) missed\.push\(String\(LLMS_TXT_COMPANIES\)\);/);
  });
});
