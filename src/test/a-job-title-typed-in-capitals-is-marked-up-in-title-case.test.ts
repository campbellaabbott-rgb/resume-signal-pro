/**
 * A JOB TITLE TYPED IN CAPITALS IS MARKED UP IN TITLE CASE, ITS INITIALISMS
 * KEPT (SEO check 2026-11-15, F12).
 *
 * The JobPosting markup carried titles exactly as their employers typed them:
 * "MFG PEE PH PR TECH", "REGISTERED NURSE- HOME CARE", "PRODEJNÍ ASISTENT V
 * PRODEJNĚ JYSK OLOMOUC". Google's content policy for job postings asks for
 * no all caps. A title with any lower-case letter is the employer's own casing
 * and is not touched.
 *
 * THE CORPUS. 7,838 job titles read on the board (the 2026-11-08 place-word
 * and posting-page corpora, the 2,722 postings of the selection-screen
 * fixture, and the ledger and /jobs list read by the SEO check). The fixture
 * holds every one of them with no lower-case letter (142), each with the title
 * its markup carries, read by hand, and every 25th title with a lower-case
 * letter (308), which must come back as it went in.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { titleFromCapitals } from "@/lib/seo/display-case";
import { postingJsonLd } from "@/components/jobs/posting-page";

const FIXTURE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/shouted-job-titles-2026-11-15.json"), "utf8")) as {
  shouted: Array<{ title: string; markup: string }>;
  review: Array<{ title: string; markup: string }>;
  mixed: string[];
};

describe("the corpus", () => {
  it("holds at least 300 titles the rule must leave alone, and every shouted title the board carried", () => {
    expect(FIXTURE.mixed.length).toBeGreaterThanOrEqual(300);
    expect(FIXTURE.shouted).toHaveLength(142);
    for (const t of FIXTURE.mixed) expect(t).not.toBe(t.toUpperCase());
    for (const s of FIXTURE.shouted) expect(s.title).toBe(s.title.toUpperCase());
  });

  it("marks up each shouted title as it was read by hand", () => {
    const wrong = FIXTURE.shouted
      .map((s) => ({ ...s, got: titleFromCapitals(s.title) }))
      .filter((s) => s.got !== s.markup)
      .map((s) => `"${s.title}": want "${s.markup}", got "${s.got}"`);
    expect(wrong).toEqual([]);
  });

  it("returns every mixed-case title as it came", () => {
    expect(FIXTURE.mixed.filter((t) => titleFromCapitals(t) !== t)).toEqual([]);
  });
});

describe("the report's titles and the rule's edges", () => {
  it.each([
    ["MFG PEE PH PR TECH", "Mfg PEE PH PR Tech"],
    ["REGISTERED NURSE- HOME CARE", "Registered Nurse- Home Care"],
    ["PRODEJNÍ ASISTENT V PRODEJNĚ JYSK OLOMOUC", "Prodejní Asistent v Prodejně JYSK Olomouc"],
    ["AIRCRAFT MECHANIC", "Aircraft Mechanic"],
    ["ANALISTA DE CATEGORIA SR", "Analista de Categoria Sr"],
    ["3D", "3D"],
  ])("%s is %s", (title, markup) => {
    expect(titleFromCapitals(title)).toBe(markup);
  });

  it.each(["Registered Nurse - ICU", "RN", "", "2027 Future Talent Program – Engineering – Co-op", "研发工程师"])("%s is left as it is", (title) => {
    expect(titleFromCapitals(title)).toBe(title);
  });
});

/**
 * THE REVIEW OF 2026-11-15 read 86 shouted titles in 77,357 public postings
 * and found about 12 mis-cased: an initialism before 's printed "Pca's", a
 * short part of a hyphenated word kept its capitals ("Live-IN", "IN-Home"),
 * an ending for the other gender kept its capitals ("Administratif(VE)"), and
 * French and Spanish articles were read as initialisms ("À LA Direction").
 * Each is a rule here, not a spelling, and all 142 hand-read board titles
 * above still come out as read.
 */
describe("the review's shouted titles", () => {
  it.each(FIXTURE.review.map((r) => [r.title, r.markup]))("%s is %s", (title, markup) => {
    expect(titleFromCapitals(title)).toBe(markup);
  });

  it("keeps an initialism joined by a hyphen, and Los Angeles, in capitals", () => {
    expect(titleFromCapitals("PA-C")).toBe("PA-C");
    expect(titleFromCapitals("NON-CDL DRIVER")).toBe("Non-CDL Driver");
    expect(titleFromCapitals("IT-SUPPORT ANALYST")).toBe("IT-Support Analyst");
    expect(titleFromCapitals("SALES REP LA")).toBe("Sales Rep LA");
    expect(titleFromCapitals("CNA IN LA")).toBe("CNA in LA");
  });

  /*
   * What the rule still leaves: a short word nothing marks as a word stays in
   * capitals ("DE VIE", "DE ARTE", "SANTA FE", "NEW HAVEN"), and "AI" is the
   * initialism. The review proposed the opposite default (capitals only for a
   * vowelless word or a listed one); run over the 142 hand-read titles above it
   * breaks 28 of them ("Mri Tech", "Nicu", "Wand", "Etf Advisory", "Huc Ed"),
   * and the board's mixed-case titles write "AI" 15 times as the initialism
   * and never as the Italian "ai". These are pinned so a change to them is a
   * decision.
   */
  it.each([
    ["AUXILIAIRE DE VIE H/F", "Auxiliaire de VIE H/F"],
    ["DIRETOR DE ARTE JUNIOR", "Diretor de ARTE Junior"],
    ["PLAZA SANTA FE", "Plaza Santa FE"],
    ["CAMERIERA AI PIANI", "Cameriera AI Piani"],
  ])("%s stays %s: a short word is not guessed into a word", (title, markup) => {
    expect(titleFromCapitals(title)).toBe(markup);
  });
});

describe("the job markup carries the title-cased title", () => {
  const row = {
    id: "greenhouse:acme:4401", token: "acme", source: "greenhouse", company: "Acme Manufacturing",
    title: "MFG PEE PH PR TECH", location: "Dayton, OH", country: "US",
    postedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), missingSince: null,
    recheckedAt: new Date(Date.now() - 600_000).toISOString(), salary: null, agency: false,
    applyUrl: "https://job-boards.greenhouse.io/acme/jobs/4401",
  };
  const desc = "Acme Manufacturing is hiring a process engineering technician for its Dayton plant, working on the press line with the quality team. ".repeat(4);

  it("names a shouted title in title case", () => {
    expect(postingJsonLd(row, desc, { site: "https://resumebooster.work" })?.title).toBe("Mfg PEE PH PR Tech");
  });

  it("names a mixed-case title as its employer typed it", () => {
    expect(postingJsonLd({ ...row, title: "Process Tech - PEE Line" }, desc, { site: "https://resumebooster.work" })?.title).toBe("Process Tech - PEE Line");
  });
});
