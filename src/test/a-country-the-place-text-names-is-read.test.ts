import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COUNTRY_MAP_VERSION,
  detectCountry,
  icimsCountry,
  smartRecruitersCountry,
  statedCountry,
  vendorCountry,
} from "../../supabase/functions/job-board/normalize.ts";

/**
 * A COUNTRY THE PLACE TEXT NAMES IS READ (job-board .102, lane 2).
 *
 * - Seventeen countries had no name in the table: "Accra, Ghana" was filed nowhere, and
 *   "Lagos, LA, Nigeria" was filed in Louisiana. They are read now, ahead of the comma-state
 *   rule. Jordan and Lebanon are also US towns, so they count only as the last segment after
 *   a place ("Amman, Jordan"), never before or after a US state.
 * - A street address with a state and ZIP and no comma ("1919 Gallows Road Suite 700 Vienna
 *   VA 22182") reads US only after a street word and when the ZIP's USPS prefix is that
 *   state's. "Palermo PA 90121" and the other eight named negatives are not.
 * - Hong Kong, Macau and Taiwan are read ahead of China ("Hong Kong SAR, China" is HK).
 * - S14X-120: an iCIMS, Lever, Breezy or Workable code that is not US or CA stands against a
 *   bare two-letter code that is also a US state or Canadian province only when that code is
 *   one of the code's country's own ISO 3166-2 subdivisions ("Chennai, TN" with IN stays IN,
 *   Tamil Nadu), and never against a state or province written out. Any other code reads as
 *   on main: GB at "London, ON" is Canada, FR at "Paris, TX" and Smoothie King's FR at
 *   "KCMO, MO" are the US (n1425). No raw-feed row of the 7,908 in board-stream-2026-11-01's
 *   Lever, Breezy, Workable and iCIMS captures has this shape, so the cases below are named.
 *
 * The corpus (fixtures/country-corpus-2026-11-11.json) carries every location string the
 * rule moves, plus SmartRecruiters and vendor-coded rows, each labelled by the vendor's own
 * code or by hand from the posting's own words, never by this rule. `main` is
 * fix/cost-wave's reading. Each case is read by the reader production uses for it.
 */
type Label = string | string[];
type Case =
  | { kind: "text"; s: string; label: Label; basis: string; main: string | null; stated: string | null }
  | { kind: "sr"; token: string; id: string; url: string; location: Record<string, string | undefined>; label: Label; basis: string; main: string | null }
  | { kind: "vendor"; reader: "vendorCountry" | "icimsCountry"; id: string; code: unknown; location: string; label: Label; basis: string; main: string | null };
const FX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/country-corpus-2026-11-11.json"), "utf8")) as {
  measured: Record<string, { rows?: number; main: Record<string, number>; head: Record<string, number> }>;
  moved: Record<string, string | null>;
  movedStated: Record<string, string | null>;
  cases: Case[];
};

const readCase = (c: Case): string | null =>
  c.kind === "text" ? detectCountry(c.s)
  : c.kind === "sr" ? smartRecruitersCountry(c.location as never, String(c.location.fullLocation ?? ""))
  : c.reader === "icimsCountry" ? icimsCountry(c.code, c.location) : vendorCountry(c.code, c.location);
const score = (v: string | null, label: Label) =>
  v === null ? "none" : (Array.isArray(label) ? label.includes(v) : v === label) ? "right" : "wrong";

describe("the seventeen names", () => {
  it("'Lagos, LA, Nigeria' is Nigeria, not Louisiana", () => {
    expect(detectCountry("Lagos, LA, Nigeria")).toBe("NG");
    expect(detectCountry("Accra, GA, Ghana")).toBe("GH");
  });

  it.each([
    ["Lagos, Nigeria", "NG"], ["Accra, Ghana", "GH"], ["Dhaka, Bangladesh", "BD"], ["Addis Ababa, Ethiopia", "ET"],
    ["Kampala, Uganda", "UG"], ["Dar es Salaam, Tanzania", "TZ"], ["Kigali, Rwanda", "RW"], ["Dakar, Senegal", "SN"],
    ["Abidjan, Côte d'Ivoire", "CI"], ["Abidjan, Ivory Coast", "CI"], ["Douala, Cameroon", "CM"], ["Algiers, Algeria", "DZ"],
    ["Colombo, Sri Lanka", "LK"], ["Kathmandu, Nepal", "NP"], ["Almaty, Kazakhstan", "KZ"], ["Lusail, Qatar", "QA"],
    ["Amman, Jordan", "JO"], ["Beirut, Lebanon", "LB"],
  ])("%s reads %s", (s, code) => {
    expect(detectCountry(s)).toBe(code);
  });

  it("Lebanon and Jordan, US towns, never read as the countries beside a US state or ZIP", () => {
    for (const s of ["Lebanon, PA", "Lebanon, NH", "Lebanon, OH", "Lebanon, TN", "Lebanon, OH 45036", "Jordan, MN", "West Jordan, UT"]) {
      expect(detectCountry(s), s).toBe("US");
    }
    for (const s of ["PA, Lebanon", "Lebanon", "Jordan"]) expect(["LB", "JO"], s).not.toContain(detectCountry(s));
  });

  // Board .102 review F15: shapes the corpus lacked, now named negatives in it too.
  it("a US state written out ahead of Lebanon or Jordan is still the US town", () => {
    for (const s of ["Tennessee, Lebanon", "Pennsylvania, Lebanon", "Ohio, Lebanon", "New Hampshire, Lebanon", "Minnesota, Jordan"]) {
      expect(detectCountry(s), s).toBe("US");
    }
    // The controls: the countries themselves still read.
    expect([detectCountry("Beirut, Lebanon"), detectCountry("Amman, Jordan")]).toEqual(["LB", "JO"]);
  });

  it("a street named for one of the seventeen is a street, not the country", () => {
    expect(detectCountry("Ghana Road, Lagos")).toBe("NG");
    expect(detectCountry("Ghana Street, Abuja")).toBe("NG");
    expect(detectCountry("Tanzania St, Austin TX 78701")).not.toBe("TZ");
    expect(detectCountry("Dar es Salaam, Tanzania"), "the control").toBe("TZ");
  });

  it("Brazil's Macau beside its state code RN is not Macao", () => {
    for (const s of ["Macau, RN", "Macau - RN", "Macau/RN"]) expect(detectCountry(s), s).not.toBe("MO");
    expect(detectCountry("Macau"), "the control").toBe("MO");
  });

  it("Brazil's Macau with its state or its country written out is not Macao", () => {
    for (const s of ["Macau, Rio Grande do Norte", "Macau, Rio Grande do Norte, Brasil", "Macau, Brazil", "Macau - RN, Brasil", "Macau, Brasil"]) {
      expect(detectCountry(s), s).not.toBe("MO");
    }
    expect(detectCountry("Macau, Macao SAR, China"), "the control").toBe("MO");
  });
});

describe("a US street address with no comma (Wien)", () => {
  it("both WorldStrides addresses read US", () => {
    expect(detectCountry("1919 Gallows Road Suite 700 Vienna VA 22182")).toBe("US");
    expect(detectCountry("218 West Water Street Suite 400 Charlottesville VA 22902")).toBe("US");
    expect(detectCountry("1919 Gallows Road Suite 700 Vienna VA 22182; 218 West Water Street Suite 400 Charlottesville VA 22902")).toBe("US");
  });

  it.each([
    "Hamburg DE 20095", "Milano MI 20121", "Varese VA 21100", "Cagliari CA 09121", "Palermo PA 90121",
    "Como CO 22100", "Trento TN 38122", "Messina ME 98121", "Belém PA 66000-000",
  ])("%s is not read US", (s) => {
    expect(detectCountry(s)).not.toBe("US");
  });

  it("a street word beside a foreign postal code that happens to fit a state's ZIP prefixes is not US", () => {
    // Board .102 review F15: 38122 is a Tennessee ZIP and a Trento CAP; 61000 an Illinois ZIP and a Tel Aviv code.
    expect(detectCountry("1 Park Lane, Trento TN 38122")).not.toBe("US");
    expect(detectCountry("Main St, Tel Aviv IL 61000")).not.toBe("US");
    expect(detectCountry("1919 Gallows Road Suite 700 Vienna VA 22182"), "the control").toBe("US");
  });

  it("a street word with a ZIP outside the state's USPS prefixes is not enough", () => {
    expect(detectCountry("Via Roma 1, Palermo PA 90121")).not.toBe("US"); // no street word in English
    expect(detectCountry("1 Main Street Palermo PA 90121")).not.toBe("US"); // 901 is Tennessee's, not Pennsylvania's
    expect(detectCountry("1 Main Street Pittsburgh PA 15222")).toBe("US");
  });

  it("a street word in another comma segment is not evidence for the state and ZIP that follow: unread, as main read it", () => {
    // Board .102 review F15. "1 Park Lane, Trento TN 38122" has the same shape as a US
    // address with a comma, and no rule without a city list tells them apart; the safe
    // default is no country. fix/cost-wave read all three null.
    for (const s of ["1 Main Street, Pittsburgh PA 15222", "1 Park Lane, Trento TN 38122", "Main St, Tel Aviv IL 61000"]) {
      expect(detectCountry(s), s).toBeNull();
    }
  });
});

describe("Hong Kong, Macau and Taiwan are read ahead of China (S14X-249)", () => {
  it.each([
    ["Hong Kong SAR, China", "HK"], ["Kwai Chung, Hong Kong, China", "HK"], ["Macau, Macao SAR, China", "MO"],
    ["Taipei, Taiwan, Province of China", "TW"], ["Hsinchu, Taiwan, China", "TW"], ["Taiwan/Hong Kong, , Taiwan", "TW"],
    ["Shanghai, China", "CN"], ["Beijing, China", "CN"],
  ])("%s reads %s", (s, code) => {
    expect(detectCountry(s)).toBe(code);
  });
});

describe("a vendor's own code that is not US or CA stands against a bare code that is one of its own subdivisions (S14X-120)", () => {
  it.each([
    ["IN", "Chennai, TN", "IN"], ["MX", "Tijuana, BC", "MX"], ["MX", "Mexicali, BC", "MX"], ["MX", "Monterrey, NL", "MX"],
    ["ES", "Barcelona, CT", "ES"], ["IT", "Milano, MI", "IT"], ["IT", "Palermo, PA", "IT"], ["BR", "Florianópolis, SC", "BR"],
    ["AU", "Darwin, NT", "AU"], ["AU", "Perth, WA", "AU"], ["NG", "Lagos, LA", "NG"], ["NL", "Utrecht, UT", "NL"],
  ])("code %s at %s is %s, by both readers", (code, place, want) => {
    expect(icimsCountry(code, place)).toBe(want);
    expect(vendorCountry(code, place)).toBe(want);
  });

  // Named negatives: a city with a famous namesake, beside a state or province that is no subdivision of the code's
  // country, or written out. The label is the place's own country; the reading is main's.
  it.each([
    ["GB", "London, Ontario", "CA"], ["GB", "London, ON", "CA"], ["GB", "Cambridge, Massachusetts", "US"], ["GB", "Cambridge, MA", "US"],
    ["GB", "Manchester, New Hampshire", "US"], ["AT", "Vienna, VA", "US"], ["AT", "Vienna, Virginia", "US"], ["EG", "Alexandria, Virginia", "US"],
    ["EG", "Alexandria, VA", "US"], ["IE", "Dublin, OH", "US"], ["IE", "Dublin, Ohio", "US"], ["FR", "Paris, TX", "US"], ["FR", "Paris, Texas", "US"],
    ["GR", "Athens, GA", "US"], ["DE", "Berlin, Connecticut", "US"], ["GB", "Birmingham, Alabama", "US"],
    ["IN", "Tennessee, TN", "US"], ["IT", "Milano, Michigan", "US"], ["AU", "Perth, Ontario", "CA"], ["PH", "Manila, MN", "US"],
  ])("code %s at %s is %s: a namesake does not carry the code", (code, place, want) => {
    expect(icimsCountry(code, place)).toBe(want);
    expect(vendorCountry(code, place)).toBe(want);
  });

  it("the US or Canada named in words, or a state written out, still wins", () => {
    expect(icimsCountry("IN", "Austin, TX, United States")).toBe("US");
    expect(icimsCountry("IN", "Chennai, TN, United States")).toBe("US");
    expect(icimsCountry("IN", "Austin, Texas")).toBe("US");
    expect(icimsCountry("PR", "FLORIDA, Florida")).toBe("US");
    expect(icimsCountry("GB", "Toronto, Ontario")).toBe("CA");
  });

  it("a city we do not know beside a state code reads as before: FR at 'KCMO, MO' is US (n1425)", () => {
    expect(icimsCountry("FR", "KCMO, MO")).toBe("US");
    expect(vendorCountry("FR", "KCMO, MO")).toBe("US");
  });

  it("a US or CA code is read as before", () => {
    expect(icimsCountry("US", "Chennai, TN")).toBe("US");
    expect(icimsCountry("CA", "Toronto, ON")).toBe("CA");
    expect(icimsCountry("CA", "Seattle, WA")).toBe("US");
  });
});

describe("the country corpus is never worse than main", () => {
  it("holds at least 300 cases of each reader's kind it judges, each with a basis", () => {
    expect(FX.cases.length).toBeGreaterThanOrEqual(300);
    expect(FX.cases.filter((c) => c.kind === "text").length).toBeGreaterThanOrEqual(300);
    expect(FX.cases.filter((c) => c.kind === "sr").length).toBeGreaterThanOrEqual(300);
    for (const c of FX.cases) expect(c.basis.length, JSON.stringify(c)).toBeGreaterThan(5);
    expect(FX.measured.sr.rows).toBeGreaterThan(40_000);
    expect(FX.measured.vendor.rows).toBeGreaterThan(18_000);
  });

  it("no case main reads right becomes wrong, and each reader's total right is at least main's", () => {
    const worse: string[] = [];
    for (const kind of ["text", "sr", "vendor"] as const) {
      const t = { main: { right: 0, wrong: 0, none: 0 }, head: { right: 0, wrong: 0, none: 0 } };
      for (const c of FX.cases.filter((x) => x.kind === kind)) {
        const now = readCase(c), m = score(c.main, c.label), h = score(now, c.label);
        t.main[m]++; t.head[h]++;
        if (m === "right" && h === "wrong") worse.push(`${kind} ${JSON.stringify(c.kind === "text" ? c.s : c.location)}: ${c.main} -> ${now} (${c.label})`);
      }
      expect(t.head.right, kind).toBeGreaterThanOrEqual(t.main.right);
      expect(t.head.wrong, kind).toBeLessThanOrEqual(t.main.wrong);
    }
    // statedCountry reads the same strings for the query and the SmartRecruiters echo; it is held to the same bar.
    const t = { main: { right: 0, wrong: 0, none: 0 }, head: { right: 0, wrong: 0, none: 0 } };
    for (const c of FX.cases) {
      if (c.kind !== "text") continue;
      const now = statedCountry(c.s), m = score(c.stated, c.label), h = score(now, c.label);
      t.main[m]++; t.head[h]++;
      if (m === "right" && h === "wrong") worse.push(`statedCountry ${JSON.stringify(c.s)}: ${c.stated} -> ${now} (${c.label})`);
    }
    expect(t.head.right).toBeGreaterThanOrEqual(t.main.right);
    expect(t.head.wrong).toBeLessThanOrEqual(t.main.wrong);
    expect(worse).toEqual([]);
  });

  it("the whole corpora measured when the fixture was built agree: right only rises, wrong only falls", () => {
    for (const [k, m] of Object.entries(FX.measured)) {
      expect(m.head.right, k).toBeGreaterThanOrEqual(m.main.right);
      expect(m.head.wrong, k).toBeLessThanOrEqual(m.main.wrong);
    }
  });

  it("every string the rule moves is labelled, and reads as the fixture recorded", () => {
    const labelled = new Set(FX.cases.filter((c) => c.kind === "text").map((c) => (c as { s: string }).s));
    // Two strings only SmartRecruiters writes: its reader keeps them where the coordinates and postal code put them.
    const srOnly = new Set(["Biloxi, MS, Algeria", "Hyderabad, Telangana, Algeria"]);
    expect(Object.keys(FX.moved).length).toBeGreaterThanOrEqual(300);
    for (const [s, now] of Object.entries(FX.moved)) {
      expect(labelled.has(s) || srOnly.has(s), s).toBe(true);
      expect(detectCountry(s), s).toBe(now);
    }
    for (const [s, now] of Object.entries(FX.movedStated)) {
      expect(labelled.has(s) || srOnly.has(s), s).toBe(true);
      expect(statedCountry(s), s).toBe(now);
    }
    const sr = FX.cases.filter((c) => c.kind === "sr" && srOnly.has(String(c.location.fullLocation)));
    expect(sr.map((c) => readCase(c)).sort()).toEqual(["IN", "US"]);
  });

  it("PROVES THE TEETH: main filed these wrong or nowhere", () => {
    const fixed = FX.cases.filter((c) => score(c.main, c.label) !== "right" && score(readCase(c), c.label) === "right");
    expect(fixed.length).toBeGreaterThanOrEqual(400);
  });

  it("the map version is 13, so the backfill re-reads the rows stored with no country", () => {
    expect(COUNTRY_MAP_VERSION).toBe(13);
  });
});
