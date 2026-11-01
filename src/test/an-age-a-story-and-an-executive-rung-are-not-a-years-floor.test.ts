// @vitest-environment node
/**
 * AN AGE, A STORY AND AN EXECUTIVE RUNG ARE NOT A YEARS FLOOR (S12-013, S13-016,
 * S13-033; bug audit 2026-10-31, board-stream group "fields").
 *
 * S12-013: Domino's drivers were filed Expert 18+ and 15+. The lines that did
 * it are the employer's own: "at least 18 years" (an age with the word "old"
 * cut off), "at least 18 years-old", "18 years young", and a franchisee's
 * story, "he started with Domino's 15 years ago as a driver". The same shape
 * filed a Hertz driver "at least 20 years", a laundry line worker "at least 18
 * years in age" and a bar job "aged at least 18 years or over" as Expert.
 *
 * S13-016: "Head of Fulfillment" with "2+ years leading people" was filed
 * Entry. A title that names an executive rung keeps it over a figure of two
 * years or fewer. Senior titles are NOT lifted: live senior+entry rows are
 * Senior Cooks, Tellers and Servers (n1420).
 *
 * S13-033: Personio states the level the employer picked (seniority,
 * yearsOfExperience). It fills only what the title and text leave unsaid.
 *
 * The age and story lines are real postings' (corpus: board-stream-2026-11-01/
 * corpora/fields/exp-diff.json, 6,243 descriptions, 15 changes).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectExperience, parseMinYears } from "../../supabase/functions/job-board/experience";
import { normalizePersonio } from "../../supabase/functions/job-board/normalize";
import { bootBoardHandler, SVC, type BoardHandler } from "./helpers/board-handler";

const IDX = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

describe("an age or a story is not a requirement (S12-013)", () => {
  it("the Domino's lines file no driver Expert", () => {
    for (const [title, text] of [
      ["Pizza Delivery driver needed Domino's Downtown Make up to $17 an hour", "Requirements: at least 18 years\nValid driver's license"],
      ["Delivery Expert", "Must be at least 18 years-old with a valid U.S. driver's license for a minimum of one year"],
      ["Delivery Expert - Southside", "Be at least 18 years young (sorry, time machines not accepted)"],
      ["Delivery Expert(05523) - 4917 Arendel St", "...and graduated from Croatan High School. He started with Domino's 15 years ago as a driver, and worked his way up the ladder to franchisee."],
    ]) {
      const e = detectExperience(title, text);
      expect(e, title).toEqual({ band: null, minYears: null });
    }
  });

  it("nor the same shape at other employers", () => {
    for (const s of [
      "Drivers must be at least 20 years",
      "Possesses a valid Maryland driver's license and minimum of 18 years required.",
      "Possesses valid Maryland driver's license and minimum of 18 years age required.",
      "As this role involves serving alcohol, you must be aged at least 18 years or over.",
      "Must be at least 18 years in age",
      "Drivers must be at least 18 years through 20 years of age may only transport equipment",
    ]) expect(parseMinYears(s), s).toBeNull();
  });

  it("a real requirement in the same range still reads", () => {
    expect(parseMinYears("Minimum of 18 years of progressive leadership experience")).toBe(18);
    expect(parseMinYears("At least 20 years in commercial construction management")).toBe(20);
    expect(parseMinYears("Requires 16 years as a licensed electrician")).toBe(16);
    expect(parseMinYears("Experience: 18 years")).toBe(18);
    expect(parseMinYears("At least 20 years of relevant work history")).toBe(20);
  });

  it("the HVAC posting keeps its real floor once the age line is gone", () => {
    const e = detectExperience("HVAC Technician", "Minimum 2 years of HVAC experience.\nPossesses valid Maryland driver's license and minimum of 18 years age required.");
    expect(e).toEqual({ band: "entry", minYears: 2 });
  });
});

describe("an executive rung keeps its band over a small figure (S13-016)", () => {
  it("Head of, Director and VP with two years or fewer are Expert", () => {
    expect(detectExperience("Head of Fulfillment and Merchandising", "Experience in operations, including 2+ years leading people or leading work across teams.")).toEqual({ band: "expert", minYears: 2 });
    expect(detectExperience("Director of Sales", "2+ years of experience in B2B sales")).toEqual({ band: "expert", minYears: 2 });
    expect(detectExperience("VP, Partnerships", "1 year of experience in partnerships")).toEqual({ band: "expert", minYears: 1 });
  });
  it("a larger figure still decides, and a senior title is not lifted", () => {
    expect(detectExperience("Director, Sales Engineering", "8+ years of professional experience in technical software")).toEqual({ band: "senior", minYears: 8 });
    expect(detectExperience("Senior Cook", "2 years of experience in a kitchen")).toEqual({ band: "entry", minYears: 2 });
    expect(detectExperience("Store Manager", "2 years of retail management experience")).toEqual({ band: "entry", minYears: 2 });
  });
});

describe("the level the employer picked fills only what the words leave unsaid (S13-033)", () => {
  const xml = (o: { title: string; et?: string; sen?: string; yrs?: string; desc?: string }) => `<?xml version="1.0"?><workzag-jobs><position>
    <id>1873173</id><office>Rotterdam</office><name>${o.title}</name>
    <jobDescriptions>${o.desc ? `<jobDescription><name>Taken</name><value><![CDATA[<p>${o.desc}</p>]]></value></jobDescription>` : ""}</jobDescriptions>
    <employmentType>${o.et ?? "permanent"}</employmentType>${o.sen ? `<seniority>${o.sen}</seniority>` : ""}
    <schedule>full-time</schedule>${o.yrs ? `<yearsOfExperience>${o.yrs}</yearsOfExperience>` : ""}
    <createdAt>2026-10-20T10:00:00+00:00</createdAt></position></workzag-jobs>`;
  const level = (o: Parameters<typeof xml>[0]) => normalizePersonio(xml(o), "Co", "tok", "jobs.personio.de")[0].level;

  it("the feed's seniority and years become a stated level", () => {
    expect(level({ title: "Boekhouder", sen: "experienced", yrs: "2-5" })).toEqual({ band: null, minYears: 2 });
    expect(level({ title: "Werkstudent", sen: "student", yrs: "lt-1" })).toEqual({ band: "entry", minYears: 0 });
    expect(level({ title: "Geschäftsführer", sen: "executive", yrs: "gt-15" })).toEqual({ band: "expert", minYears: 15 });
    expect(level({ title: "Koch", sen: "entry-level" })).toEqual({ band: "entry", minYears: null });
    expect(level({ title: "Koch", yrs: "unknown" })).toEqual({ band: null, minYears: null });
  });

  it("the posting's text and title still win; the stated level fills silence", () => {
    expect(detectExperience("Boekhouder / Financieel Medewerker", null, { band: null, minYears: 2 })).toEqual({ band: "entry", minYears: 2 });
    expect(detectExperience("Projektleiter", "Du bringst Erfahrung mit.", { band: null, minYears: 7 })).toEqual({ band: "senior", minYears: 7 });
    expect(detectExperience("Engineer", "5+ years of experience", { band: "entry", minYears: 0 })).toEqual({ band: "mid", minYears: 5 });
    expect(detectExperience("Senior Engineer", null, { band: "entry", minYears: null })).toEqual({ band: "senior", minYears: null });
    expect(detectExperience("Engineer", null, { band: "expert", minYears: null })).toEqual({ band: "expert", minYears: null });
    expect(detectExperience("Engineer", null, null)).toEqual({ band: null, minYears: null });
  });

  it("the ingest hands the stated level to the band", () => {
    expect(IDX).toContain('detectExperience(j.title ?? "", lightDescs ? null : (descs.get(j.id) ?? null), j.level)');
  });
});

describe("the v3 sweep re-derives stored rows and leaves Personio's to the feed", () => {
  let h: BoardHandler;
  beforeAll(async () => { h = await bootBoardHandler(); }, 120_000);
  async function chainKey(): Promise<string> {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SVC}:board-chain`));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  }
  it("clears the Domino's age line, lifts the Head of, and never touches a Personio row", async () => {
    const STORED = [
      { id: "smartrecruiters:dominos:744000158412268", title: "Delivery Expert", description: "Must be at least 18 years-old with a valid U.S. driver's license", experience_band: "expert", min_years: 18 },
      { id: "ashby:arb-interactive:99468c27", title: "Head of Fulfillment and Merchandising", description: "Experience in operations, including 2+ years leading people or leading work across teams.", experience_band: "entry", min_years: 2 },
      // Its band came from the stated level at ingest; the sweep cannot see that level, so it must not judge the row.
      { id: "personio:acme:1873173", title: "Boekhouder", description: null, experience_band: "entry", min_years: 2 },
    ];
    h.reset();
    h.answer((q) => (q.table === "job_board_postings" && q.calls.some(([m]) => m === "select") ? { data: STORED, error: null } : undefined));
    const r = await h.post({ action: "backfill-experience", chainKey: await chainKey(), rulesVersion: 3 });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, done: true, scanned: 3, updated: 2 });
    const writes = h.db.on("job_board_postings", "update").flatMap((q) => {
      const patch = q.calls.find(([m]) => m === "update")?.[1][0];
      return ((q.calls.find(([m]) => m === "in")?.[1][1] as string[]) ?? []).map((id) => [id, patch] as const);
    });
    const byId = new Map(writes);
    expect(byId.get("smartrecruiters:dominos:744000158412268")).toEqual({ experience_band: "unspecified", min_years: null });
    expect(byId.get("ashby:arb-interactive:99468c27")).toEqual({ experience_band: "expert", min_years: 2 });
    expect(byId.has("personio:acme:1873173")).toBe(false);
  });
});
