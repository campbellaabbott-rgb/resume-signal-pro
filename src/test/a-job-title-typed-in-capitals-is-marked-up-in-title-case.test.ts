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
