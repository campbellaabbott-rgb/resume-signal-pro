// A DOT- OR SPACE-GROUPED FIGURE WAS SPLIT BY THE GROUNDING CHECK.
//
// The S8-032 fix read comma grouping only. generate-cover-letter writes a
// Spanish letter for a Spanish posting, and Spanish, German, Dutch and
// Portuguese group thousands with a dot, French with a space. So an invented
// "10.000 Kunden", "1.000.000 registros" or "10 000 clients" passed (each
// split into "10" and "000", both dropped as small counts), while an honest
// "2.500" or "2 500" against a source "2,500" was refused with a 422 naming
// "500".

import { describe, it, expect } from "vitest";
import { unsupportedNumericClaims } from "../../supabase/functions/_shared/resume-grounding";

const SOURCE = "Support lead at Acme. Managed 2,500 customers and a $40,000 budget. GPA 3.875.";

describe("dot- and space-grouped figures are checked as whole figures", () => {
  it("refuses invented dot-grouped and space-grouped figures", () => {
    expect(unsupportedNumericClaims(SOURCE, "Betreute 10.000 Kunden.")).toEqual(["10.000"]);
    expect(unsupportedNumericClaims(SOURCE, "Gestionó 1.000.000 registros.")).toEqual(["1.000.000"]);
    expect(unsupportedNumericClaims(SOURCE, "Géré 10 000 clients.")).toEqual(["10 000"]);
    expect(unsupportedNumericClaims(SOURCE, "Géré 10 000 clients.")).toEqual(["10 000"]);
  });

  it("accepts an honest figure grouped with a dot or a space against a comma-grouped source", () => {
    expect(unsupportedNumericClaims(SOURCE, "Betreute 2.500 Kunden.")).toEqual([]);
    expect(unsupportedNumericClaims(SOURCE, "Géré 2 500 clients.")).toEqual([]);
    expect(unsupportedNumericClaims(SOURCE, "Gestionó un presupuesto de $40.000.")).toEqual([]);
  });

  it("still reads decimals, percentages and a GPA as before", () => {
    expect(unsupportedNumericClaims(SOURCE, "Graduated with a GPA of 3.875.")).toEqual([]);
    expect(unsupportedNumericClaims(SOURCE, "Grew revenue 3.5% in Q2.")).toEqual(["3.5%"]);
  });
});
