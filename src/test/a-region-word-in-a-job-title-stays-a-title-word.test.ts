// @vitest-environment node
/**
 * A REGION WORD IN A JOB TITLE STAYS A TITLE WORD (MCP upgrade 3, W1 lane L2:
 * F1 part 4, M9).
 *
 * WHAT WAS WRONG (the design, before the critiques): U3-05 read region words
 * anywhere in the query and turned them into a country filter. Titles carry
 * them: "EMEA Sales Director", "APAC Partnerships Lead", "EU Policy Officer",
 * "DACH Sales Manager", "Nordics Account Executive", a graduate role "at ANZ"
 * (a bank), "EU Affairs". Moving the word out changes the job searched for.
 * The seniority half of the same design would have set the experience filter
 * from "senior", a filter that covers about 39% of the board and mislabels.
 *
 * WHAT IS TRUE NOW: a region word is read from the query only right after
 * "in", "across", "within" or "throughout", at the end of the query. Measured
 * on 731 real board titles that carry a region word (15 public board reads,
 * 2026-11-17, appended to fixtures/model-queries-2026-11.json with the row
 * each came from; 737 were read, 6 were already in the corpus), not one has
 * that shape, and every one keeps its region word in the words searched. The seeker negatives appended beside them read
 * exactly as main read them (judged in the query-reader corpus test). A
 * seniority word is never moved to a filter: no reading carries experience.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readQuery } from "../../supabase/functions/agent-mcp/query-place";
import { readRegionArgs } from "../../supabase/functions/agent-mcp/search-notes";

type TitleRow = { title: string; company: string; location: string | null; country: string | null; seed: string; mainRight: boolean };
const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/model-queries-2026-11.json"), "utf8")) as {
  seeker: Array<{ q: string; want: Record<string, unknown>; source: string }>;
  titles: TitleRow[];
};
const REGION_SEEDS = ["EMEA", "APAC", "DACH", "Nordics", "EU", "Europe", "LATAM", "ANZ", "Benelux", "Iberia", "Baltics", "North America", "Global", "International", "UK & Ireland"];
const REGION_TITLES = CORPUS.titles.filter((t) => REGION_SEEDS.includes(t.seed));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s*&\s*/g, " & ").replace(/\s+/g, " ");

describe("the negatives corpus is real and big enough to judge the rule", () => {
  it("holds at least 300 board titles with a region word, from every seed", () => {
    expect(REGION_TITLES.length).toBeGreaterThanOrEqual(300);
    for (const seed of REGION_SEEDS) expect(REGION_TITLES.filter((t) => t.seed === seed).length, seed).toBeGreaterThanOrEqual(10);
  });

  it("holds the critiques' own examples as seeker negatives", () => {
    const qs = CORPUS.seeker.filter((s) => s.source === "seeker-region-negative").map((s) => s.q);
    expect(qs).toEqual(expect.arrayContaining(["EMEA Sales Director", "APAC Partnerships Lead", "EU Policy Officer", "DACH Sales Manager", "Nordics Account Executive", "Graduate Analyst at ANZ", "EU Affairs Manager"]));
  });
});

describe("a region word beside a role noun is never read as a region", () => {
  it("every board title keeps its region word in the words searched, and no region is read from it", () => {
    const moved = REGION_TITLES.filter((row) => {
      const r = readQuery(row.title);
      return r.region !== undefined || !fold(r.query).includes(fold(row.seed));
    }).map((row) => ({ title: row.title, got: readQuery(row.title) }));
    expect(moved).toEqual([]);
  });

  it.each([
    "EMEA Sales Director", "APAC Partnerships Lead", "EU Policy Officer", "DACH Sales Manager", "Nordics Account Executive",
    "Graduate Analyst at ANZ", "EU Affairs Manager", "Head of EU Affairs", "North America Operations Manager", "VP Sales EMEA",
    "Sales Manager - Nordics", "Head of Sales for Europe", "Lecturer in International Relations", "Analyst in Global Markets",
    "Researcher in European Studies", "AI Infrastructure & Platform Operations Engineer (remote in the EU)",
  ])("%s reads whole", (q) => {
    const r = readQuery(q);
    expect(r.query).toBe(q);
    expect(r.region).toBeUndefined();
    expect(r.location).toBeUndefined();
    expect(r.country).toBeUndefined();
  });

  it('"jobs at ANZ" is the employer, not the region', () => {
    expect(readQuery("graduate jobs at ANZ")).toMatchObject({ query: "graduate", companies: ["ANZ"] });
    expect(readQuery("graduate jobs at ANZ").region).toBeUndefined();
  });

  it("the same region word after in is a region: position is the whole rule", () => {
    expect(readQuery("Sales Director in EMEA")).toMatchObject({ query: "Sales Director", location: "EMEA" });
    expect(readQuery("Account Executive in the Nordics")).toMatchObject({ query: "Account Executive", location: "Nordics" });
    expect(readRegionArgs({ query: "Account Executive", location: "Nordics" })!.args).toEqual({ location: null, country: "DK,FI,IS,NO,SE" });
    expect(readQuery("Policy Officer in the EU").region?.key).toBe("eu");
    expect(readQuery("Partnerships Lead across APAC")).toMatchObject({ query: "Partnerships Lead", location: "APAC" });
  });
});

describe("seniority words stay title words", () => {
  const SENIOR = ["senior data engineer jobs in Europe", "Senior Data Engineer in DACH", "junior developer jobs in the Nordics", "lead nurse jobs within the EU", "principal engineer throughout North America", "Staff Engineer in EMEA", "Head of Data across Benelux", "entry level analyst jobs in the UK and Ireland", "senior data engineer"];

  it.each(SENIOR)("%s keeps its level word in the query and sets no experience filter", (q) => {
    const r = readQuery(q) as Record<string, unknown>;
    const level = /\b(senior|junior|lead|principal|staff|head|entry level)\b/i.exec(q)![1];
    expect(String(r.query).toLowerCase()).toContain(level.toLowerCase());
    expect(r.experience).toBeUndefined();
    expect(r.experienceLevel).toBeUndefined();
  });

  it("the region reader for location and country never sets one either", () => {
    const r = readRegionArgs({ query: "senior data engineer", location: "Europe" }) as unknown as { args: Record<string, unknown> };
    expect(Object.keys(r.args).sort()).toEqual(["country", "location"]);
  });
});
