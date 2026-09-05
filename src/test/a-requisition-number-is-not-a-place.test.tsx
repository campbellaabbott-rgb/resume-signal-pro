// A REQUISITION NUMBER IS NOT A PLACE.
//
// Seen live on the board, as the second line of a card and again in the detail
// panel it opens:
//
//     Leidos · 0250 36th CS Andersen Air Force Base Guam - Expat
//
// "0250" is a cost centre. "36th CS" is a communications squadron. Neither is a
// place, neither means anything to a job seeker, and between them they push the
// only word on the line a human recognises — Guam — past the fold on a phone.
// `location` is free text exactly as the employer's HR system emits it, and
// Workday tenants in particular emit the internal facility designator.
//
// ── THE THREE CONSTRAINTS THIS FIX HAD TO CLEAR ─────────────────────────────
//
// 1. NOTHING IS INVENTED. displayLocation only ever REMOVES tokens from the
//    employer's own string. It does not geocode, does not expand an
//    abbreviation into a city, and never substitutes a place the employer did
//    not write. The property test below is the mechanical form of that rule:
//    every word that survives must be a word that was already there.
// 2. MEANING SURVIVES. Remote / hybrid / expat / "multiple locations" are the
//    difference between a job somebody can take and one they cannot. They are
//    words with no digits in them, so nothing in the code can reach them, and
//    the tests pin each of them individually because "no rule can reach it" is
//    exactly the kind of claim a later rule quietly falsifies.
// 3. THE RAW STRING IS NEVER LOST. The card hangs it on the title attribute
//    whenever the display differs; the panel prints it in full, under its own
//    label, whenever tokens were actually dropped.
//
// ── AND THE HOUSE RULE ON TOP OF ALL THREE ──────────────────────────────────
//
// A location that is ONLY an internal code renders NOTHING — not a mangled
// fragment of the code, not an empty separator. The row's own `country` column
// is a stated field and it is the only thing left to say; countryToName already
// governs when that may be said, and the card now reads it against WHAT IT
// SHOWS rather than against the raw column, so a location reduced to nothing
// leaves the country as the only place fact and states it.
//
// The JSON-LD is deliberately untouched: structured data is read by machines
// that want the employer's own string, and this is a DISPLAY fix.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));

function stubTable() {
  const th: Record<string, unknown> = {};
  const self = () => th;
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in"]) th[k] = self;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import Jobs, { displayLocation, isLocationCodeToken } from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
// CODE is asserted against comment-stripped source; PROSE against the raw file.
// Asserting a comment's own words against stripped source (or a code literal
// against raw source that also carries it in a comment) is this repo's oldest
// guard bug, and the comments this fix added are full of its own identifiers.
const RAW = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const JOBS = RAW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const SLOW = { timeout: 4000 } as const;

const LEIDOS_RAW = "0250 36th CS Andersen Air Force Base Guam - Expat";

type Row = {
  id: string; company: string; title: string; location: string | null; country: string | null;
  salary: null; applyUrl: string; source: string; token: string; category: string; postedAt: string | null;
};
const row = (over: Partial<Row> = {}): Row => ({
  id: "j0", company: "Acme", title: "Backend Engineer", location: "Remote", country: null,
  salary: null, applyUrl: "https://x/0", source: "greenhouse", token: "acme",
  category: "engineering", postedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), ...over,
});

// One posting per case, each stating EXACTLY what its case needs.
const ROWS: Row[] = [
  // The live defect, verbatim.
  row({ id: "j1", company: "Leidos", token: "leidos", title: "Systems Administrator", location: LEIDOS_RAW, country: "GU", applyUrl: "https://x/1" }),
  // A location that is ONLY an internal code. There is no place to show.
  row({ id: "j2", company: "Beta", token: "beta", title: "Field Technician", location: "REQ-8842-0031", country: "US", applyUrl: "https://x/2" }),
  // Already readable. It must come out the other side byte-identical.
  row({ id: "j3", company: "Gamma", token: "gamma", title: "Warehouse Associate", location: "Austin, TX, USA", country: "US", applyUrl: "https://x/3" }),
  // No location text at all: the country is then the only place fact there is.
  row({ id: "j4", company: "Delta", token: "delta", title: "Quiet Role", location: null, country: "FR", applyUrl: "https://x/4" }),
];

function mount(path = "/jobs") {
  window.history.replaceState({}, "", path);
  // NON-EMPTY for get_salary_benchmarks on purpose: an empty answer arms a
  // 1.5s retry inside Jobs, which then fires after this file's next mockReset
  // and surfaces as an unhandled rejection under parallel load.
  rpc.mockImplementation(async (fn: string) => (
    fn === "get_salary_benchmarks"
      ? { data: [{ category: "engineering", currency: "USD", n: 4_000, median_annual_min: 100_000 }] }
      : { data: [] }
  ));
  invoke.mockImplementation(async (fn: string, o: { body?: Record<string, unknown> } | undefined) => {
    const b = o?.body ?? {};
    if (fn === "job-fit") return { data: { terms: [], fits: {}, missing: {}, matched: {} } };
    if (fn === "job-board" && b.action === "detail") {
      return { data: { job: ROWS.find((r) => r.id === b.id) ?? null, description: "We need somebody." } };
    }
    if (fn === "job-board" && b.action === "list") {
      if (b.facetCounts) return { data: { categories: {} } };
      if (b.countOnly) return { data: { total: ROWS.length } };
      return {
        data: {
          jobs: ROWS, total: ROWS.length, totalAllCompanies: ROWS.length, companies: [],
          companiesCount: 0, categories: {}, failedSources: [], failedCount: 0,
          refreshedAt: null, hasMore: false,
        },
      };
    }
    return { data: {} };
  });
  return render(<MemoryRouter><Jobs /></MemoryRouter>);
}

const card = (id: string) => document.querySelector(`[data-job-id="${id}"]`);
const cardText = (id: string) => card(id)?.textContent ?? "";
const panel = () => (screen.getAllByRole("dialog")[0]?.textContent ?? "");

describe("a requisition number is not a place", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/jobs");
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* blocked */ }
    invoke.mockReset(); rpc.mockReset();
  });

  it("the live defect: the cost centre and the squadron go, the place and the posting-shape stay", () => {
    const d = displayLocation(LEIDOS_RAW);
    expect(d.text).toBe("Andersen Air Force Base Guam · Expat");
    // Each half of the claim, separately, so a mutation that half-works fails.
    expect(d.text).not.toContain("0250");
    expect(d.text).not.toContain("36th");
    expect(d.text).not.toContain("CS ");
    expect(d.text, "the place the employer actually named").toContain("Andersen Air Force Base");
    expect(d.text, "Guam is the only word on that line a human recognises").toContain("Guam");
    expect(d.text, "expat changes whether a seeker can take the job").toContain("Expat");
    // The raw string travels with it, always.
    expect(d.raw).toBe(LEIDOS_RAW);
    expect(d.reduced).toBe(true);
  });

  it("nothing is invented: every word shown was already in the employer's string", () => {
    // The mechanical form of constraint 1. A rule that ADDS a place — expands
    // an abbreviation, appends a country, guesses a city from a code — fails
    // here whatever it looks like at a call site.
    const corpus = [
      LEIDOS_RAW,
      "Austin, TX, USA", "Cambridge", "Berlin, Germany", "Remote", "Hybrid",
      "HQ Chicago, IL", "MIT Campus", "Sao Paulo, SP, Brazil", "US-VA-Reston",
      "Winston-Salem, NC", "1600 Amphitheatre Parkway, Mountain View, CA",
      "5 Locations", "Multiple Locations - Remote", "New York, NY 10001",
      "London, United Kingdom | Hybrid", "REQ-8842-0031", "R0000123", "0250",
      "", "   ", "München", "Bengaluru, KA",
    ];
    for (const raw of corpus) {
      const { text } = displayLocation(raw);
      if (text === null) continue;
      const source = raw.toLowerCase();
      for (const word of text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
        expect(source, `"${word}" is not in ${JSON.stringify(raw)}`).toContain(word);
      }
    }
  });

  it("a location that is only a code renders NOTHING — never a mangled fragment", () => {
    for (const code of ["REQ-8842-0031", "R0000123", "0250", "JR-1029384", "12345"]) {
      const d = displayLocation(code);
      expect(d.text, code).toBeNull();
      expect(d.raw, "and it is still available to the caller").toBe(code);
    }
    // No text at all is the same answer, and it is not "reduced" — there was
    // nothing to reduce.
    expect(displayLocation(null)).toEqual({ text: null, raw: null, reduced: false });
    expect(displayLocation("   ")).toEqual({ text: null, raw: null, reduced: false });
  });

  it("a readable location comes out byte-identical, and says so", () => {
    // The commonest case by far, and the one a scrubber is most likely to
    // damage. `reduced: false` is what keeps the panel from printing a
    // "verbatim" row that repeats the line above it word for word.
    for (const clean of [
      "Austin, TX, USA", "Cambridge", "Berlin, Germany", "Remote",
      "Sao Paulo, SP, Brazil", "Winston-Salem, NC", "München", "5 Locations",
      "MIT Campus", "US-VA-Reston",
    ]) {
      const d = displayLocation(clean);
      expect(d.text, clean).toBe(clean);
      expect(d.reduced, clean).toBe(false);
    }
  });

  it("meaning survives: mode, expat and multi-site are never scrubbed", () => {
    // Each of these is the difference between a job somebody can take and one
    // they cannot, and each is pinned on its own.
    const cases: [string, string][] = [
      ["REQ-1234 Remote", "Remote"],
      ["0250 Boston - Hybrid", "Hybrid"],
      ["R000123 Onsite - Austin, TX", "Onsite"],
      [LEIDOS_RAW, "Expat"],
      ["JR-88 Multiple Locations", "Multiple Locations"],
      ["5 Locations", "5 Locations"],
    ];
    for (const [raw, kept] of cases) {
      expect(displayLocation(raw).text, raw).toContain(kept);
    }
  });

  it("what counts as a code is drawn where a quantity cannot be mistaken for one", () => {
    // Leading zero, four digits or more, or opening the string. A short
    // digits-only token in the MIDDLE is a quantity ("5 Locations") and is
    // left alone — dropping it would be an edit, not a tidy.
    expect(isLocationCodeToken("0250", false)).toBe(true);
    expect(isLocationCodeToken("10001", false)).toBe(true);
    expect(isLocationCodeToken("1600", true)).toBe(true);
    expect(isLocationCodeToken("36th", false)).toBe(true);
    expect(isLocationCodeToken("REQ-1234", false)).toBe(true);
    expect(isLocationCodeToken("5", false), "a count, not a code").toBe(false);
    expect(isLocationCodeToken("12", false), "a count, not a code").toBe(false);
    expect(isLocationCodeToken("Guam", false)).toBe(false);
    expect(isLocationCodeToken("München", false)).toBe(false);
    expect(isLocationCodeToken("Winston-Salem", false)).toBe(false);
  });

  it("an opening acronym is dropped only when it cannot be a place and words remain", () => {
    // "CS" and "HQ" are org units. "SP", "CA" and "US" are places the SEARCH
    // side already expands, read straight off its own tables so the display
    // can never tidy away something the filter understands.
    expect(displayLocation("HQ Chicago, IL").text).toBe("Chicago, IL");
    expect(displayLocation("CS Andersen Air Force Base Guam").text).toBe("Andersen Air Force Base Guam");
    expect(displayLocation("CA San Francisco Bay").text, "a province code is a place").toBe("CA San Francisco Bay");
    expect(displayLocation("US Fort Meade Maryland").text, "a country code is a place").toBe("US Fort Meade Maryland");
    // Two words must survive it, so a two-word line keeps its acronym rather
    // than being cut in half.
    expect(displayLocation("MIT Campus").text).toBe("MIT Campus");
    expect(displayLocation("HQ Chicago").text).toBe("HQ Chicago");
  });

  it("behaviour: the card shows the place and keeps the employer's string one hover away", async () => {
    mount();
    await waitFor(() => expect(cardText("j1")).toContain("Systems Administrator"), SLOW);
    expect(cardText("j1")).toContain("Andersen Air Force Base Guam");
    expect(cardText("j1"), "the cost centre reached a reader").not.toContain("0250");
    expect(cardText("j1"), "the squadron reached a reader").not.toContain("36th");
    expect(cardText("j1"), "expat is not a detail we may drop").toContain("Expat");
    // NOTHING IS HIDDEN: the raw string is on the element that carries the
    // tidied text, so it is one hover from the reader on the card itself.
    expect(card("j1")?.querySelector(`[title="${LEIDOS_RAW}"]`), "the raw string left the page entirely").not.toBeNull();
  });

  it("behaviour: a code-only location shows the country we hold, not a fragment of the code", async () => {
    mount();
    await waitFor(() => expect(cardText("j2")).toContain("Field Technician"), SLOW);
    expect(cardText("j2"), "a requisition number rendered as a place").not.toContain("REQ-8842");
    expect(cardText("j2"), "a mangled fragment of it rendered as a place").not.toContain("8842");
    // The country column is a stated field and it is now the only place fact
    // there is, so it is said rather than swallowed.
    expect(cardText("j2")).toContain("United States");
    // And it is still suppressed where the location line already answers.
    expect(cardText("j3"), "the location line already said USA").not.toContain("United States");
    expect(cardText("j3"), "a readable location is left exactly as written").toContain("Austin, TX, USA");
    // A row with no location text at all: same rule, same answer.
    expect(cardText("j4")).toContain("France");
  });

  it("behaviour: the panel prints the employer's untouched string under its own label", async () => {
    mount("/jobs?job=j1");
    await waitFor(() => expect(panel()).toContain("Systems Administrator"), SLOW);
    expect(panel(), "the panel repeated the raw string as the location").toContain("Andersen Air Force Base Guam");
    // In full, under a label that says what it is — a disclosure, not a
    // tooltip, on the surface where the decision is actually made.
    expect(panel()).toContain("Location, verbatim");
    expect(panel()).toContain(LEIDOS_RAW);
    expect(panel()).toContain("requisition and site codes removed");
  });

  it("behaviour: a location we did not change gets no verbatim row", async () => {
    // Repeating an identical string under a second label is noise, not
    // disclosure — and it would appear on the great majority of postings.
    mount("/jobs?job=j3");
    await waitFor(() => expect(panel()).toContain("Warehouse Associate"), SLOW);
    expect(panel()).toContain("Austin, TX, USA");
    expect(panel()).not.toContain("Location, verbatim");
  });

  it("both surfaces read the place through the same helper, and the country follows what is SHOWN", () => {
    expect(JOBS, "the card").toMatch(/const cardLoc = displayLocation\(job\.location\);/);
    expect(JOBS, "the panel").toMatch(/const detailLoc = displayLocation\(detailJob\?\.location\);/);
    // THE SHARP EDGE. Read against job.location, a posting whose location is
    // pure code would have its country suppressed by a country name sitting
    // inside the code — and the card would then show no place at all.
    expect(JOBS).toMatch(/const cardCountry = countryToName\(cardLoc\.text, job\.country\);/);
    // The folded siblings and the compare tray are the two other places a
    // location reaches a reader, and they read the same helper.
    expect(JOBS).toMatch(/displayLocation\(sib\.location\)/);
    expect(JOBS).toMatch(/displayLocation\(j\.location\)/);
    // The vocabulary comes from the search side's own tables, not a second
    // hand-typed list that can drift away from what the filter understands.
    expect(JOBS).toMatch(/import \{ STATE_ALIASES, METRO_ALIASES \} from "\.\.\/\.\.\/supabase\/functions\/_shared\/location-terms";/);
    expect(JOBS).toMatch(/\.\.\.Object\.keys\(STATE_ALIASES\)/);
  });

  it("the JSON-LD still carries the employer's own string, untouched", () => {
    // A machine reading structured data wants what the employer wrote. This is
    // a DISPLAY fix and it must not quietly become a structured-data one.
    expect(JOBS).toMatch(/addressLocality: detailJob\.location\.slice\(0, 120\)/);
    expect(JOBS).not.toMatch(/addressLocality: displayLocation/);
  });

  it("the reason a short middle number survives stays written down", () => {
    // PROSE, so raw source. Delete this and the next person tightens the digit
    // rule until "5 Locations" loses its 5, which is an edit to a fact.
    expect(RAW).toMatch(/is LEFT ALONE,\s*\/\/\s*because "5 Locations" is a fact/);
    expect(RAW).toMatch(/NOTHING IS INVENTED/);
  });
});
