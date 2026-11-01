/**
 * A POSTING NAMES ITS HIRING SYSTEM ONLY BY A LINK (register S13-005).
 *
 * The free scan guessed the employer's ATS from company words matched
 * anywhere in the posting: "att" in "attention" made a nurse's posting
 * BrassRing, "aws" in "laws" or "SAP" made it Workday, "meta" in "metadata"
 * Greenhouse. The prompt then told the model to name that system in the red
 * flags, and the card read "Target ATS: brassring", the raw id, because the
 * response set the name and the parser strength to it.
 *
 * Measured on 2,067 real postings whose real vendor is known (corpus in
 * ~/.config/resumebooster/free-scan-wave-corpora/S13-005): main made 1,670
 * claims, 1,496 of them wrong; the branch made 27, all right, and missed no
 * posting that links its vendor. Every posting main got right without a link
 * (a company word that happened to match the vendor) is one the branch now
 * leaves as unknown, which the page does not show.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { atsProfileOf, detectAtsSystem } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import slice from "./fixtures/free-scan-wave/s13-005-ats-from-links.json";

describe("company words name no system", () => {
  const texts = [
    "Registered Nurse. Strong attention to detail and compassion for patients.",
    "We comply with all applicable federal, state and local laws.",
    "Maintain product metadata and SAP master data.",
    "Experience with AWS, Oracle databases and Salesforce.",
    "Partner with UPS and FedEx on outbound logistics.",
    "Visit unilever.com to learn about our brands.",
    "Our blog lives at laugh.io",
  ];
  for (const t of texts) it(JSON.stringify(t), () => expect(detectAtsSystem(t)).toBe("unknown"));
});

describe("a link or a mail address at the vendor names it", () => {
  const cases: Array<[string, string]> = [
    ["Apply at https://jobs.lever.co/acme/123", "lever"],
    ["Apply: boards.greenhouse.io/acme.", "greenhouse"],
    ["acme.wd5.myworkdayjobs.com/en-US/careers", "workday"],
    ["Humana will send an email from Humana@myworkday.com with instructions", "workday"],
    ["recruiter email addresses end in @mastec.com or @talent.icims.com.", "icims"],
    ["https://jobs.ashbyhq.com/acme/abc", "ashby"],
  ];
  for (const [t, want] of cases) it(`${t} → ${want}`, () => expect(detectAtsSystem(t)).toBe(want));
});

describe("the page gets the system's name, not its id", () => {
  it("Workday is a weak parser, Greenhouse a strong one", () => {
    expect(atsProfileOf("workday")).toEqual({ name: "Workday", parsingStrength: "weak" });
    expect(atsProfileOf("brassring")).toEqual({ name: "BrassRing (IBM Kenexa)", parsingStrength: "weak" });
    expect(atsProfileOf("greenhouse")).toEqual({ name: "Greenhouse", parsingStrength: "strong" });
  });
  it("the response spreads the profile", () => {
    const primary = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8");
    expect(primary).toMatch(/responseData\.atsSystem = atsSystem !== 'unknown' \? \{\s*system: atsSystem,\s*\.\.\.atsProfileOf\(atsSystem\),/);
    expect(primary).not.toMatch(/name: atsSystem,/);
  });
});

describe("the corpus slice: real posting text", () => {
  const cases = (slice as { cases: Array<{ id: string; vendor: string; text: string; expected: string; main: string }> }).cases;
  it("holds at least 60 windows, most of them ones main got wrong", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(cases.filter((c) => c.main !== c.expected).length).toBeGreaterThanOrEqual(cases.length / 2);
  });
  for (const c of cases) {
    it(`${c.id} → ${c.expected}`, () => {
      expect(detectAtsSystem(c.text)).toBe(c.expected);
      if (c.expected !== "unknown") expect(c.expected).toBe(c.vendor);
    });
  }
});

describe("one detector in both forks", () => {
  it("no company-word table is left", () => {
    const root = resolve(__dirname, "../../supabase/functions");
    for (const f of ["free-keyword-scan/market-intelligence.ts", "free-keyword-scan-stream/market-intelligence.ts"]) {
      expect(readFileSync(resolve(root, f), "utf8")).not.toMatch(/COMPANY_ATS_MAP/);
    }
  });
});
