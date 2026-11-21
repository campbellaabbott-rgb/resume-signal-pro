// @vitest-environment node
/**
 * A DEMAND EMPLOYER ABOVE ITS FLOOR GETS A PAGE, AND NO INCUMBENT LOSES ONE
 * (SEO audit 2026-11-18, OPP-1; owner yes 2026-11-19).
 *
 * The bake gave a company page to the 500 boards with the most open roles, so
 * OpenAI (265 open roles on 2026-11-18), Stripe, Databricks and Anthropic,
 * names a job seeker searches for, sat under a cut near 300 and served noindex
 * stubs. src/data/demand-employers.ts names them; selectLanders adds the ones
 * with at least 50 open roles, at most 40, after the volume cut, so every
 * board the cut chose keeps its page.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectLanders } from "../../scripts/prerender-pages.mjs";
import { DEMAND_EMPLOYER_CAP, DEMAND_EMPLOYER_MIN_OPEN, DEMAND_EMPLOYER_TOKENS } from "@/data/demand-employers";
import { codeOf } from "./helpers/strip-comments";

type Row = { token: string; name: string; open: number };
const incumbents: Row[] = Array.from({ length: 520 }, (_, i) => ({ token: `big${i}`, name: `Big Employer ${i}`, open: 2000 - i * 3 }));
const openOf = (c: Row) => c.open;
const pick = (facet: Row[], o: Record<string, unknown> = {}) => (selectLanders(facet, { openOf, max: 500, ...o }) as Array<{ token: string; demand?: boolean }>);

describe("the demand boards", () => {
  const facet = [...incumbents, { token: "openai", name: "OpenAI", open: 265 }, { token: "sierra", name: "Sierra", open: 40 }, { token: "acme", name: "Acme", open: 265 }];

  it("one at or above its floor joins the chosen set, marked as such", () => {
    const chosen = pick(facet, { demand: new Set(["openai", "sierra"]), demandMin: 50, demandCap: 40 });
    expect(chosen.find((c) => c.token === "openai")?.demand).toBe(true);
    expect(chosen.some((c) => c.token === "sierra"), "under the floor of 50").toBe(false);
    expect(chosen.some((c) => c.token === "acme"), "not a demand board, under the cut").toBe(false);
  });

  it("is counted above the ceiling: every board the volume cut chose keeps its place", () => {
    const without = pick(facet).map((c) => c.token);
    const withDemand = pick(facet, { demand: new Set(["openai"]), demandMin: 50, demandCap: 40 }).map((c) => c.token);
    expect(without).toHaveLength(500);
    expect(withDemand).toHaveLength(501);
    expect(without.filter((t) => !withDemand.includes(t))).toEqual([]);
  });

  it("stops at its cap, the largest first", () => {
    const many: Row[] = Array.from({ length: 45 }, (_, i) => ({ token: `ai${i}`, name: `AI Lab ${i}`, open: 60 + i }));
    const chosen = pick([...incumbents, ...many], { demand: new Set(many.map((c) => c.token)), demandMin: 50, demandCap: 40 }).filter((c) => c.demand).map((c) => c.token);
    expect(chosen).toHaveLength(40);
    expect(chosen).not.toContain("ai0");
    expect(chosen).toContain("ai44");
  });

  it("with no demand list, the choice is today's", () => {
    expect(pick(facet).map((c) => c.token)).toEqual(pick(facet, { demand: new Set() }).map((c) => c.token));
    expect(pick(facet).some((c) => c.demand)).toBe(false);
  });

  it("a board already chosen by volume is not added twice", () => {
    const chosen = pick(facet, { demand: new Set(["big3", "openai"]), demandMin: 50, demandCap: 40 });
    expect(chosen.filter((c) => c.token === "big3")).toHaveLength(1);
    expect(chosen).toHaveLength(501);
  });
});

describe("the list and the bake", () => {
  it("names the audit's stubs first, at most its cap, each a board token, none twice", () => {
    expect(DEMAND_EMPLOYER_MIN_OPEN).toBe(50);
    expect(DEMAND_EMPLOYER_CAP).toBe(40);
    expect(DEMAND_EMPLOYER_TOKENS.length).toBeLessThanOrEqual(DEMAND_EMPLOYER_CAP);
    expect(new Set(DEMAND_EMPLOYER_TOKENS).size).toBe(DEMAND_EMPLOYER_TOKENS.length);
    expect(DEMAND_EMPLOYER_TOKENS.slice(0, 5)).toEqual(["openai", "stripe", "zscaler", "databricks", "anthropic"]);
    for (const t of DEMAND_EMPLOYER_TOKENS) expect(t).toMatch(/^[A-Za-z0-9._~-]+$/);
  });

  it("the bake hands the list to both of its lander choices, with the list's floor and cap", () => {
    const seo = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
    const pages = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-pages.mjs"), "utf8"));
    expect(seo).toMatch(/const DEMAND_BOARDS = new Set\(D\.DEMAND_EMPLOYER_TOKENS \?\? \[\]\);/);
    expect(seo.match(/demand: DEMAND_BOARDS/g)?.length).toBe(2);
    expect(pages).toMatch(/demand, demandMin: D\.DEMAND_EMPLOYER_MIN_OPEN \?\? 50, demandCap: D\.DEMAND_EMPLOYER_CAP \?\? 40/);
  });
});
