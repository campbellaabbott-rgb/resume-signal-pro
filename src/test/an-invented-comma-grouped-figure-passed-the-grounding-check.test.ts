// AN INVENTED COMMA-GROUPED FIGURE PASSED THE GROUNDING CHECK (sweep S8-032).
//
// The only invented-metric check on paid, employer-facing documents (cover
// letters, Apply kits, agent cover notes) split "10,000" into "10" and "000"
// and dropped both as small counts, so "I supported 10,000 users" passed
// against a résumé that never said it, while an honest "2,500" against a
// source "2500" was refused with a 422 naming "500".

import { describe, it, expect } from "vitest";
import { unsupportedNumericClaims, validateProseClaims } from "../../supabase/functions/_shared/resume-grounding";

const SOURCE = "Support lead at Acme. Managed 2500 customers and a $40,000 budget. Cut ticket backlog 35%.";

describe("comma-grouped figures are checked like any other figure", () => {
  it("refuses invented grouped figures", () => {
    const bad = unsupportedNumericClaims(SOURCE, "I supported 10,000 users and 5,000 customers, and migrated 1,000,000 records.");
    expect(bad).toEqual(expect.arrayContaining(["10,000", "5,000", "1,000,000"]));
  });

  it("accepts an honest figure written with a separator the source left out", () => {
    expect(unsupportedNumericClaims(SOURCE, "Managed 2,500 customers.")).toEqual([]);
  });

  it("accepts an honest figure written without the separator the source used", () => {
    expect(unsupportedNumericClaims("Raised 12,000 in donations.", "Raised 12000 in donations.")).toEqual([]);
  });

  it("names the whole figure, not a fragment of it", () => {
    const issues = validateProseClaims(SOURCE, "Grew the community to 25,000 members.");
    expect(issues).toEqual(['Figure "25,000" does not appear in the source resume']);
  });

  it("still lets years and small counts through", () => {
    expect(unsupportedNumericClaims(SOURCE, "Joined in 2019 with a team of 4.")).toEqual([]);
  });
});
