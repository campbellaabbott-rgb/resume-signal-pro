/**
 * A WAGE CHIP NAMES THE VISA CLASSES ITS FILE HOLDS (S14X-184).
 *
 * The cells come from the Department of Labor's "LCA Programs (H-1B, H-1B1,
 * E-3)" disclosure file, loaded with no --visa filter: the recorded run adds
 * up with no class dropped (certified 401,412 = refused 387,510 + matched
 * 12,851 + held 1,051). The chip said "Filed H-1B wages", naming one class of
 * three. Now it names all three, the payload records the class set the run
 * kept (LCA_VISA_CLASSES, null = every class), the run record states it, and
 * the loader prints it.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROW = {
  ow_company_token: "acmewidgets", ow_soc_code: "15-1252", ow_soc_title: "Software Developers", ow_worksite_state: "CA",
  ow_wage_low: 120000, ow_wage_high: 145600, ow_wage_median: 124800, ow_filings_n: 12, ow_match_basis: "soc_and_state",
  ow_employer_filings_n: 21, ow_employer_cells_n: 2, ow_fiscal_quarter: "FY2026 Q1-Q3",
  ow_source_file: "LCA_Disclosure_Data_FY2026_Q3.xlsx", ow_source_url: "https://www.dol.gov/media/LCA_Disclosure_Data_FY2026_Q3.xlsx",
  ow_published_on: "2026-08-07", ow_coverage_from: "2025-10-01", ow_coverage_to: "2026-06-30",
};
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: async () => ({ data: [ROW] }) } }));

import "@/i18n";
import { LcaFiledWagesLine } from "@/components/jobs/LcaFiledWagesLine";
import { parseRunRecord, renderPayload, visaClassesOf } from "../../scripts/emit-lca-payload.mjs";

const ROOT = resolve(__dirname, "../..");
const RUN = readFileSync(resolve(ROOT, "scripts/data/oflc/lca-FY2026Q3-run.txt"), "utf8");
const PAYLOAD = readFileSync(resolve(ROOT, "supabase/functions/layoff-filings/lca-payload.ts"), "utf8");

describe("the chip names every class the file holds", () => {
  it("the rendered chip says H-1B, H-1B1 and E-3, and the quarter", async () => {
    render(<LcaFiledWagesLine companyToken="acmewidgets" companyName="Acme Widgets" socCode="15-1252" worksiteState="US-CA" />);
    const chip = await screen.findByText(/Filed LCA wages/);
    expect(chip.textContent).toContain("H-1B1");
    expect(chip.textContent).toContain("E-3");
    expect(chip.textContent).toContain("FY2026 Q1-Q3");
  });

  it("every language's chip names the three classes and keeps the quarter", () => {
    for (const l of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const s = JSON.parse(readFileSync(resolve(ROOT, `src/i18n/shards/layoff-filings/${l}.json`), "utf8")).layoffFilings.lcaChip as string;
      for (const c of ["H-1B,", "H-1B1", "E-3", "{{quarter}}"]) expect(s, `${l}: ${c}`).toContain(c);
    }
  });
});

describe("the payload records the class set its run kept", () => {
  it("the run record states visa_classes=all, and the arithmetic it cites adds up with no class dropped", () => {
    const rec = parseRunRecord(RUN);
    expect(rec.visa_classes).toBe("all");
    const n = (k: string) => Number(rec[k]);
    const refused = n("single_token") + n("ambiguous") + n("unmatched") + n("held_non_ascii");
    const held = n("wage_not_filed_yearly") + n("wage_outside_plausible_band") + n("no_soc") + n("no_state") + n("no_decision_date") + n("no_readable_wage");
    expect(refused + n("matched_rows") + held, "a certified row went somewhere a class filter would put it").toBe(n("certified_by_equality"));
  });

  it("lca-payload.ts declares LCA_VISA_CLASSES as the record says (null for every class), and the emitter writes that line", () => {
    const shipped = /export const LCA_VISA_CLASSES: readonly string\[\] \| null = (null|\[[^\]]*\]);/.exec(PAYLOAD)?.[1];
    expect(shipped, "the payload does not say which visa classes it holds").toBe("null");
    const rec = parseRunRecord(RUN);
    expect(visaClassesOf(rec)).toBeNull();
    const text = renderPayload({
      record: rec, provenance: { source_file: "f.xlsx", source_url: "https://x/f.xlsx", fiscal_quarter: "FY2026 Q1-Q3", coverage_from: "2025-10-01", coverage_to: "2026-06-30", published_on: "2026-08-07" },
      rows: [], tokens: 0, base64: "", gzipBytes: 0, jsonBytes: 0,
    });
    expect(text).toContain("export const LCA_VISA_CLASSES: readonly string[] | null = null;");
    expect(visaClassesOf({ visa_classes: "H-1B" })).toEqual(["H-1B"]);
    expect(() => visaClassesOf({})).toThrow(/visa_classes/);
  });

  it("the loader prints the class set it used", () => {
    const loader = readFileSync(resolve(ROOT, "scripts/load-oflc-lca.mjs"), "utf8");
    expect(loader).toMatch(/console\.error\(`\[load-oflc-lca\] visa_classes=\$\{visaClasses\.length > 0 \? visaClasses\.join\(","\) : "all"\}`\)/);
  });
});
