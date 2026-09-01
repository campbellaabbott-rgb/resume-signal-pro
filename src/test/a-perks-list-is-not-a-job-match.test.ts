import { describe, expect, it } from "vitest";
import { isPerkListMatch, rerankWindow } from "../../supabase/functions/job-board/search-routing";

/**
 * THREE OF THE TOP TEN FOR q="Costco" WERE BENEFITS BOILERPLATE.
 *
 * Live results, 2026-09-01, with ts_headline's own marked snippets as the
 * evidence — a plumbing dispatcher, a CNC machinist and a project manager,
 * each matching on one word inside a perks enumeration:
 *
 *   "Company Paid Gym Membership, [[Costco]] Membership & Chiropractic Care"
 *   "[[Costco]] membership option"
 *   "[[Costco]] Membership Reimbursement"
 *
 * The fourth row matched the same single word and was genuinely relevant —
 * "regular travel to [[Costco]] Wholesale stores" — which is the reason the
 * rule reads the CONTEXT of the match instead of counting occurrences. A
 * mention is not noise because it is brief; it is noise because of the list it
 * sits in.
 *
 * DEMOTION, NOT REMOVAL, and the distinction is load-bearing. The related
 * count comes from SQL; dropping rows in the edge would make the page
 * contradict the number printed above it, which is the class of defect this
 * codebase has repeatedly paid for. Demoted rows still appear, still count,
 * and simply stop outranking jobs that are actually about the query.
 */
describe("a perks list is not a job match", () => {
  const PERK = "Gym Membership, [[Costco]] Membership & Chiropractic Care";
  const REAL = "The Role - regular travel to [[Costco]] Wholesale stores to promote products";

  it("reads the context of the match, not its length", () => {
    expect(isPerkListMatch(PERK)).toBe(true);
    expect(isPerkListMatch(REAL)).toBe(false);
  });

  it("keeps a row whose match appears in the role even if perks follow", () => {
    // One mention in the body of the job is enough, however many benefits
    // lists come after it. Written with the newlines a real ts_headline
    // snippet carries — the sections are what the rule reads.
    expect(isPerkListMatch(`${REAL}\nBenefits include [[Costco]] Membership`)).toBe(false);
  });

  it("treats an unmarked or absent snippet as keep, never as boilerplate", () => {
    // The default has to be to keep: a row we cannot read is not a row we may
    // silently bury.
    expect(isPerkListMatch(undefined)).toBe(false);
    expect(isPerkListMatch("")).toBe(false);
    expect(isPerkListMatch("no markers here at all")).toBe(false);
  });

  it("demotes boilerplate below a genuinely related row", () => {
    const rows = [
      { title: "Dispatcher", company: "Blue Sky Plumbing & Heating", snippet: PERK },
      { title: "Brand Ambassador", company: "Renuity", snippet: REAL },
    ];
    expect(rerankWindow(rows, "Costco")[0].company).toBe("Renuity");
  });

  it("never reorders a row the title or company already separates", () => {
    // The third key is reached only on a tie of the first two, so a real title
    // match outranks a non-boilerplate row regardless of snippets.
    const rows = [
      { title: "Warehouse Associate", company: "Acme", snippet: REAL },
      { title: "Costco Brand Promoter", company: "Next Door & Window", snippet: PERK },
    ];
    expect(rerankWindow(rows, "Costco")[0].title).toBe("Costco Brand Promoter");
  });

  it("demotes rather than removes — every row survives the window", () => {
    const rows = [
      { title: "Dispatcher", company: "Blue Sky", snippet: PERK },
      { title: "CNC Machinist", company: "Sulzer", snippet: "[[Costco]] membership option" },
      { title: "Brand Ambassador", company: "Renuity", snippet: REAL },
    ];
    expect(rerankWindow(rows, "Costco")).toHaveLength(3);
  });
});
