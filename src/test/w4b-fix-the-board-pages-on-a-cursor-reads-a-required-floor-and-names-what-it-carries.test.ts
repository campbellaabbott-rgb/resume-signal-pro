// @vitest-environment node
/**
 * THE BOARD PAGES ON A CURSOR PAST 10,000, READS A REQUIRED FLOOR, AND NEVER
 * SAYS IT DOES NOT CARRY AN EMPLOYER IT CARRIES TWICE (wave 4 round 2 review,
 * search and agents lenses).
 *
 * WHAT WAS WRONG.
 *   - S12-122's offset ceiling refused any anonymous body with offset over
 *     10,000, even with a valid keyset cursor, which the browse path seeks on
 *     and never reads the offset for. The page sends both, so the site's own
 *     cursor-paged browse broke past 10,000 rows.
 *   - S12-126's wish test read the whole comma-delimited clause: "Bachelor's
 *     degree preferred and 5+ years ... required" lost its 5-year floor, "BSN
 *     preferred with 2 years of acute care experience" lost its 2, and an
 *     "Additional Qualifications" heading turned required years into wishes.
 *     EXPERIENCE_VERSION 2 re-derives every stored row with these rules.
 *   - When every name in a scope was refused, a name refused because two
 *     carried employers share it went into unknownCompanies, which agent-mcp
 *     tells the person's AI means "this board does not carry".
 *
 * WHAT HOLDS NOW (the shipped handler where a route is involved).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { detectExperience, parseMinYears } from "../../supabase/functions/job-board/experience";
import { ANON, bootBoardHandler, type BoardHandler } from "./helpers/board-handler";
import { row } from "./helpers/board-list";
import type { Query } from "./helpers/proxy-db";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

describe("a required floor is read even beside a wish", () => {
  it("the review's three cases", () => {
    expect(detectExperience("Senior Software Engineer", "Bachelor's degree preferred and 5+ years of software engineering experience required.")).toMatchObject({ minYears: 5 });
    expect(detectExperience("Registered Nurse", "BSN preferred with 2 years of acute care experience.")).toMatchObject({ band: "entry", minYears: 2 });
    expect(detectExperience("Software Engineer", "Additional Qualifications\n- 6+ years of experience building distributed systems")).toMatchObject({ band: "senior", minYears: 6 });
  });

  it("controls: a wish that belongs to the years is still a wish", () => {
    expect(parseMinYears("5+ years of experience preferred")).toBeNull();
    expect(parseMinYears("Ideally 4 years of experience in retail")).toBeNull();
    expect(parseMinYears("Experience: 3 years of retail experience (a plus)")).toBeNull();
    expect(parseMinYears("Basic Qualifications\n- 2+ years of experience in SQL\nPreferred Qualifications\n- 6+ years of experience with Spark")).toBe(2);
  });
});

describe("through the shipped handler", () => {
  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); });
  beforeEach(() => h.reset());
  const anon = { authorization: `Bearer ${ANON}`, apikey: ANON };
  const CURSOR = { ep: "2026-10-01T10:00:00.000+00:00", id: "greenhouse:acme:999", k: "ep" };

  it("an anonymous browse past 10,000 that pages on a valid cursor is served by the seek", async () => {
    h.answer((q: Query) => (q.table === "job_board_postings" ? { data: [row("greenhouse:acme:1", "Registered Nurse")], error: null } : undefined));
    const r = await h.post({ action: "list", country: "US", offset: 12_000, cursor: CURSOR, limit: 60 }, anon);
    expect(r.error, JSON.stringify(r).slice(0, 200)).toBeUndefined();
    const seek = h.db.queries.filter((q: Query) => q.table === "job_board_postings" && q.calls.some(([m, a]) => m === "or" && String(a[0]).includes(`id.gt."${CURSOR.id}"`)));
    expect(seek.length, "the page was read by the cursor").toBeGreaterThan(0);
  });

  it("controls: no cursor, a text search, or a salary sort past 10,000 is still refused", async () => {
    for (const body of [
      { action: "list", country: "US", offset: 12_000, limit: 60 },
      { action: "list", q: "nurse", offset: 12_000, cursor: CURSOR, limit: 60 },
      { action: "list", sort: "salary", offset: 12_000, cursor: CURSOR, limit: 60 },
      { action: "list", offset: 12_000, cursor: { ...CURSOR, id: 'x",y' }, limit: 60 },
    ]) {
      h.reset();
      expect(await h.post(body, anon), JSON.stringify(body)).toMatchObject({ error: "offset_too_deep" });
    }
  });

  it("a name two carried employers share is not listed as one the board does not carry", async () => {
    h.answer((q: Query) => {
      const isRefresh = q.table === "job_board_meta" && q.calls.some(([m, a]) => m === "eq" && a[0] === "k" && a[1] === "refresh")
        && q.calls.some(([m, a]) => m === "select" && String(a[0]).includes("companiesFacet"));
      if (!isRefresh) return undefined;
      return { data: { companiesFacet: [{ token: "flex", name: "Flex", count: 9 }, { token: "flextronics~wd1~Careers", name: "Flex", count: 600 }], companiesOpen: { flex: 9, "flextronics~wd1~Careers": 572 } }, error: null };
    });
    const r = await h.post({ action: "list", companies: ["Flex", "Nowhere Corp"], limit: 10 });
    expect(r.unknownCompanies).toEqual(["Nowhere Corp"]);
    const flex = (r.companiesUnresolved as Array<{ asked: string; ambiguous?: boolean; candidates: unknown[] }>).find((u) => u.asked === "Flex");
    expect(flex).toMatchObject({ ambiguous: true });
    expect(flex?.candidates).toHaveLength(2);
  });
});
