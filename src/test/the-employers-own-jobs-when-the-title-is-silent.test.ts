import { describe, expect, it } from "vitest";
import { rerankWindow } from "../../supabase/functions/job-board/search-routing";

/**
 * q="Costco" RETURNED A PLUMBING DISPATCHER AND A SUBSTITUTE TEACHER.
 *
 * Measured 2026-09-01 by scoring the results the live board actually served.
 * Every other intent type scored near-perfect precision@5 — exact titles, role
 * families, abbreviations, typos, niche roles, punctuation, and natural
 * language all around 1.00 — while employer names scored 0.20.
 *
 * The mechanism: rerankWindow scored the TITLE and nothing else. A query that
 * names an employer says nothing about the work, so the employer's own job
 * ("Cashier" at Costco Wholesale) scores exactly zero — the same as a
 * description-tier match with no connection to the query at all. Zero ties
 * with zero, and the order fell through to whatever the index returned.
 * Meanwhile "Costco Brand Promoter" at a marketing agency scored high, because
 * it really does have the word in its title.
 *
 * The fix is a TIEBREAK, not a boost, and the distinction is the whole point:
 * company match is consulted only where the title scores are equal, so it
 * cannot touch a query the title already separates. Occupation searches, which
 * had nothing to gain, cannot be harmed by it.
 */
describe("the employer's own jobs, when the title is silent", () => {
  const row = (title: string, company: string) => ({ title, company });

  it("lifts the employer's own job above an unrelated tie", () => {
    // Both titles score zero against "Costco"; only one is a Costco job.
    const out = rerankWindow(
      [row("Dispatcher", "Blue Sky Plumbing & Heating"), row("Cashier", "Costco Wholesale Corporation")],
      "Costco",
    );
    expect(out[0].company).toBe("Costco Wholesale Corporation");
  });

  it("does NOT outrank a genuine title match — it is a tiebreak, not a boost", () => {
    // A title carrying the query is a stronger signal than a company name
    // carrying it, and this ordering must not invert that.
    const out = rerankWindow(
      [row("Cashier", "Costco Wholesale Corporation"), row("Costco Brand Promoter", "Next Door & Window")],
      "Costco",
    );
    expect(out[0].title).toBe("Costco Brand Promoter");
  });

  it("leaves an occupation search exactly as it was", () => {
    // The hazard this shape avoids: "nurse" must not start preferring a
    // company whose NAME contains the word over actual nursing jobs.
    const out = rerankWindow(
      [row("Registered Nurse", "Mercy Hospital"), row("Warehouse Associate", "Nurse Staffing Inc")],
      "nurse",
    );
    expect(out[0].title).toBe("Registered Nurse");
  });

  it("stays a total order, so page two cannot repeat page one", () => {
    // Equal on both keys: original index still decides, as it always did.
    const rows = [row("Cashier", "Acme"), row("Greeter", "Acme"), row("Stocker", "Acme")];
    expect(rerankWindow(rows, "Acme").map((r) => r.title)).toEqual(["Cashier", "Greeter", "Stocker"]);
  });
});
