import { describe, expect, it } from "vitest";
import { normalizeFilters, ISO_ALPHA2 } from "../../supabase/functions/job-board/filters.ts";

/**
 * TWO FILTERS THAT MATCHED NOTHING AND SAID NOTHING.
 *
 * L8-10: country accepted any two letters. {q:"nurse", country:"UK"} (the usual
 * wrong spelling of GB, which agents routinely emit) and country:"XX" answered
 * total 0 with no ignoredFilters, while GB answered 314: "no nursing jobs in
 * the UK" presented as a market fact.
 *
 * L13-68: maxAgeDays accepted 1.5. The RPC binds an integer, so the ranked
 * path failed with 22P02 and fell back unranked (total 62 against 130 for 2).
 */
const norm = (b: Record<string, unknown>) => normalizeFilters(b, 64);

describe("country is an ISO code, and UK means GB", () => {
  it("reads UK as GB and names nothing", () => {
    const r = norm({ country: "UK" });
    expect(r.applied.country).toBe("GB");
    expect(r.ignored).not.toContain("country");
    expect(norm({ country: "uk" }).applied.country).toBe("GB");
  });

  it("drops a code no country has, and names it", () => {
    const r = norm({ country: "XX" });
    expect(r.applied.country).toBeNull();
    expect(r.ignored).toContain("country");
    const mixed = norm({ country: "US,XX" });
    expect(mixed.applied.country).toBe("US");
    expect(mixed.ignored).toContain("country");
    expect(mixed.ignored.filter((f) => f === "country").length, "named once").toBe(1);
  });

  it("keeps every real code, alone or in a list, without a notice", () => {
    for (const c of ["US", "GB", "DE", "IN", "XK"]) {
      expect(ISO_ALPHA2.has(c), c).toBe(true);
      const r = norm({ country: c });
      expect(r.applied.country, c).toBe(c);
      expect(r.ignored, c).not.toContain("country");
    }
    expect(norm({ country: ["DE", "GB"] }).applied.country).toBe("DE,GB");
    expect(ISO_ALPHA2.size).toBe(250);
  });

  it("still names a list cut at five", () => {
    const r = norm({ country: "US,GB,DE,FR,ES,IT" });
    expect(r.applied.country).toBe("US,GB,DE,FR,ES");
    expect(r.ignored).toContain("country");
  });
});

describe("maxAgeDays is whole days", () => {
  it("refuses a fraction and names it, instead of breaking the ranked search", () => {
    const r = norm({ maxAgeDays: 1.5 });
    expect(r.applied.maxAgeDays).toBeNull();
    expect(r.ignored).toContain("maxAgeDays");
    expect(norm({ maxAgeDays: "2.5" }).applied.maxAgeDays).toBeNull();
  });

  it("keeps whole days, the clamp and its notice", () => {
    expect(norm({ maxAgeDays: 2 }).applied.maxAgeDays).toBe(2);
    expect(norm({ maxAgeDays: "7" }).applied.maxAgeDays).toBe(7);
    const c = norm({ maxAgeDays: 90 });
    expect(c.applied.maxAgeDays).toBe(30);
    expect(c.maxAgeClamped).toBe(true);
    const f = norm({ maxAgeDays: 30.5 });
    expect(f.applied.maxAgeDays).toBeNull();
    expect(f.maxAgeClamped, "a refused value is not also a clamped one").toBe(false);
    expect(norm({ maxAgeDays: 0 }).ignored).not.toContain("maxAgeDays");
  });
});
