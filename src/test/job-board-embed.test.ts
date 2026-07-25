// Semantic-search embed input (task #168).
//
// gte-small truncates at 512 tokens and embeds English text into 384 dims.
// The input builder is title-forward on purpose: feeding a whole 14KB JD would
// push the text that says what the role IS past the truncation point. These
// tests pin the budget and shape so a future edit can't silently regress the
// embedding quality of 570k rows.
import { describe, it, expect } from "vitest";
import { buildEmbedInput } from "../../supabase/functions/job-board/descriptions";

describe("buildEmbedInput — the text a posting is embedded from", () => {
  it("leads with the title, then company/location, then the description opening", () => {
    const out = buildEmbedInput("Senior Nurse", "Acme Health", "Boston, MA", "Provide patient care across units.");
    expect(out.split("\n")).toEqual([
      "Senior Nurse",
      "Acme Health — Boston, MA",
      "Provide patient care across units.",
    ]);
  });

  it("caps the description slice and the total budget", () => {
    const out = buildEmbedInput("T", "C", "L", "x".repeat(10_000));
    expect(out.length).toBeLessThanOrEqual(1600);
    // description contributes at most 1200 chars
    expect(out.split("\n")[2].length).toBeLessThanOrEqual(1200);
  });

  it("collapses description whitespace so token budget isn't spent on formatting", () => {
    const out = buildEmbedInput("T", "C", "L", "line one\n\n\n   line   two\t\tend");
    expect(out.split("\n")[2]).toBe("line one line two end");
  });

  it("omits empty parts instead of emitting separators", () => {
    expect(buildEmbedInput("Only Title", null, null, null)).toBe("Only Title");
    expect(buildEmbedInput("T", "Acme", null, null)).toBe("T\nAcme");
    expect(buildEmbedInput("T", null, "Remote", null)).toBe("T\nRemote");
    expect(buildEmbedInput(null, null, null, null)).toBe("");
  });

  it("is stable for a title-only posting (the pre-description embed case)", () => {
    // A row embedded before its description arrives gets embedded_desc=false
    // and is re-embedded later — but the title-only embed must still be a
    // meaningful sentence, not empty.
    const out = buildEmbedInput("CDL-A Truck Driver", "Drive Co", "Pueblo, CO", "");
    expect(out).toBe("CDL-A Truck Driver\nDrive Co — Pueblo, CO");
  });
});
