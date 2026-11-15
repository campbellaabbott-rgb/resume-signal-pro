import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSmartRecruiters, smartRecruitersCountry } from "../../supabase/functions/job-board/normalize.ts";

/**
 * SMARTRECRUITERS STATES THE COUNTRY WHEN WE READ NONE (ThePlace1, verifier line 1909).
 *
 * ThePlace1 posts "Yenegwe, BY, Nigeria" and "Benin City, ED, Nigeria" with location.country
 * "ng". The reader found no country in the place text and answered null, though the vendor
 * had stated one: two of the board's eight Nigeria rows were filed nowhere. The stated code
 * was right on 372 of 373 rows (n1392). Now smartRecruitersCountry ends `return read ?? stated`.
 *
 * Two things this must not do:
 * - store a placeholder: SmartRecruiters writes "xx" (OTHER), and "un" and "zz" are not
 *   countries either;
 * - let the vendor's own name for its code decide the rows n1392 keeps. SmartRecruiters ends
 *   the place with its English name for the code, so once Algeria is in the name table,
 *   "Biloxi, MS, Algeria" would read DZ and agree with the stated "dz". For the seventeen
 *   new names that echo is not read, so Domino's Biloxi row (coordinates in Mississippi)
 *   stays US and TechVedika's Hyderabad row stays IN.
 */
type Loc = { city?: string; region?: string; country?: string; latitude?: string; longitude?: string; fullLocation?: string };
const FX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/country-corpus-2026-11-11.json"), "utf8")) as {
  cases: Array<{ kind: string; token?: string; id?: string; location?: Loc; label?: string; main?: string | null }>;
};
const N1392 = JSON.parse(readFileSync(resolve(__dirname, "fixtures/trust-pages-country/smartrecruiters-postings.json"), "utf8")) as Array<{ token: string; id: string; location: Loc }>;
const row = (token: string, id: string, location: Loc) =>
  normalizeSmartRecruiters({ content: [{ id, name: "Captured posting", location }] } as never, token, token)[0];

describe("a stated code stands when the place text names no country", () => {
  it("a place we read nothing from, with the vendor's ng, is Nigeria", () => {
    expect(smartRecruitersCountry({ country: "ng" } as never, ", ")).toBe("NG");
    expect(smartRecruitersCountry({ country: "ng", city: "Yenegwe", region: "BY" } as never, "Yenegwe, BY")).toBe("NG");
    expect(smartRecruitersCountry({ country: "NG" } as never, "")).toBe("NG");
  });

  it("the ThePlace1 board: every captured posting is filed NG, the two read as nowhere included", () => {
    const board = FX.cases.filter((c) => c.kind === "sr" && c.token === "ThePlace1");
    expect(board.length).toBeGreaterThanOrEqual(8);
    const ids = new Set<string>();
    for (const c of board) {
      ids.add(c.id!);
      expect(row("ThePlace1", c.id!, c.location!)?.country, `${c.id} ${c.location!.fullLocation}`).toBe("NG");
    }
    const once = board.filter((c) => c.main === null).map((c) => c.location!.fullLocation);
    expect(once.sort()).toEqual(["Benin City, ED, Nigeria", "Yenegwe, BY, Nigeria"]);
  });

  it("the StandardBankGroup captures whose place is a bare ',' are filed where the vendor states", () => {
    const bare = N1392.filter((r) => r.token === "StandardBankGroup" && r.location.fullLocation === ", ");
    expect(bare.length).toBe(4);
    for (const r of bare) expect(row(r.token, r.id, r.location)?.country, r.id).toBe(String(r.location.country).toUpperCase());
  });

  it("a placeholder code is never stored", () => {
    for (const code of ["xx", "XX", "un", "zz"]) {
      expect(smartRecruitersCountry({ country: code } as never, ", "), code).toBeNull();
      expect(smartRecruitersCountry({ country: code, city: "Paris" } as never, "Paris, , France"), code).toBe("FR");
    }
  });
});

describe("the reading still decides where it reads one", () => {
  it("Domino's Biloxi row stays US beside its stray dz, and TechVedika's Hyderabad stays IN", () => {
    const dominos = N1392.find((r) => r.token === "Dominos" && /Biloxi/.test(String(r.location.fullLocation)))!;
    const tech = N1392.find((r) => r.token === "TechVedika" && /Algeria/.test(String(r.location.fullLocation)))!;
    expect(row(dominos.token, dominos.id, dominos.location)?.country).toBe("US");
    expect(row(tech.token, tech.id, tech.location)?.country).toBe("IN");
  });

  it("a stated new-name code whose place names the same country still reads it", () => {
    expect(smartRecruitersCountry({ country: "ng", city: "Lagos", region: "LA", latitude: "6.44", longitude: "3.48" } as never, "Lagos, LA, Nigeria")).toBe("NG");
    expect(smartRecruitersCountry({ country: "gh", city: "Accra" } as never, "Accra, , Ghana")).toBe("GH");
    expect(smartRecruitersCountry({ country: "jo", city: "Amman" } as never, "Amman, , Jordan")).toBe("JO");
  });

  it("a reading outside the US and Canada is never overruled by the stated code", () => {
    expect(smartRecruitersCountry({ country: "de", city: "Paris" } as never, "Paris, , France")).toBe("FR");
  });
});
