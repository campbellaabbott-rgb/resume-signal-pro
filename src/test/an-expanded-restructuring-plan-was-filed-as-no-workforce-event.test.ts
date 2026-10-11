// @vitest-environment node
/**
 * AN EXPANDED RESTRUCTURING PLAN WAS FILED AS NO WORKFORCE EVENT (review of
 * sweep S8-026, 2026-10-10).
 *
 * The S8-026 rule marks an Item 2.05 section as a status update when it names
 * its plan as previously announced. Expanding an earlier plan is a common 2.05
 * shape, and it names that plan the same way: "approved an expansion of the
 * Company's previously announced restructuring plan, which will result in a
 * reduction of approximately 300 additional employees" was stored
 * is_workforce_event = false, so the card printed the neutral exit-cost
 * sentence with no headcount and the partition's filed arm dropped the
 * employer. A section that commits to new, additional, expanded or
 * second-phase reductions is a new cut.
 */
import { describe, expect, it } from "vitest";
import { buildSecRow } from "../../supabase/functions/layoff-filings/edgar";

const READ_AT = new Date("2026-09-18T15:40:00Z");
const docHtml = (section: string) =>
  `<html><body><p>Item 2.05 Costs Associated with Exit or Disposal Activities.</p><p>${section}</p><p>Item 9.01 Financial Statements and Exhibits.</p></body></html>`;
const row = (section: string) => buildSecRow({
  cik: 4242, adsh: "0001234567-26-000011", filerName: "Acme Corp", form: "8-K", reportDate: "2026-08-28", filingDate: "2026-09-01",
  primaryDocument: "acme_8k.htm", documentHtml: docHtml(section), amendsAdsh: null, readAt: READ_AT,
}).row;

describe("a new cut under a previously announced plan", () => {
  it("an expansion of the plan is a workforce event with its headcount", () => {
    const r = row("On August 28, 2026, the Board of Directors of Acme Corp approved an expansion of the Company's previously announced restructuring plan, which will result in a reduction of approximately 300 additional employees, or about 5% of the Company's workforce.");
    expect(r.is_workforce_event, "an expansion of an earlier plan was stored as no workforce event").toBe(true);
    expect(r.headcount).toBe(300);
  });
  it("a second phase of the plan is a workforce event", () => {
    const r = row("On August 28, 2026, the Company approved a second phase of its previously announced restructuring plan, eliminating approximately 450 positions.");
    expect(r.is_workforce_event).toBe(true);
    expect(r.headcount).toBe(450);
  });
  it("positive control: a progress report on the plan is still no new workforce event", () => {
    const r = row("As part of the previously announced restructuring plan, the Company has now reduced its workforce by approximately 120 employees. The restructuring plan is substantially complete.");
    expect(r.is_workforce_event).toBe(false);
  });
});
