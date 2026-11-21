// @vitest-environment node
/**
 * A CONTRACT, TEMPORARY OR SEASONAL TITLE IS MARKED SO (SEO audit 2026-11-18,
 * STRUCTURED-B11).
 *
 * AMD's "Talent Acquisition Operations Specialist (Contract)" was marked
 * PART_TIME only, so Google for Jobs' Contractor filter never showed it, and
 * no seasonal or temporary posting carried TEMPORARY unless its feed happened
 * to say so. The employer's own title now adds CONTRACTOR or TEMPORARY beside
 * the stated type. The corpus is every distinct title the bake served,
 * retired or kept as gone in the live ledgers of 2026-11-18 and 2026-11-21
 * (fixtures/served-posting-titles-2026-11-21.json, 1,507 titles, labelled by
 * hand): the rule marks exactly the labelled ones, the four that name
 * contract work as the job area among the titles it leaves alone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import type { PostingRow } from "@/components/jobs/posting-page";

type Labelled = { title: string; path: string; types: string[] };
const CORPUS: { titles: Labelled[] } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/served-posting-titles-2026-11-21.json"), "utf8"));
type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string; jp: { employmentType?: unknown } | null };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));

/** Read through the namespace so this file fails, not breaks, on a main without it. */
const titleTypes = (t: string): string[] => {
  const f = (postingPage as unknown as { postingTitleEmploymentTypes?: (t: string) => string[] }).postingTitleEmploymentTypes;
  return typeof f === "function" ? f(t) : [];
};
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);
const DAY = 86_400_000;
const rowOf = (r: Served, employmentType: string | null = null): PostingRow => ({
  id: r.id, source: r.source, token: r.token, title: r.title, company: r.company,
  location: r.location, country: r.country, postedAt: new Date(Date.now() - DAY).toISOString(),
  applyUrl: null, salary: null, agency: false, workMode: null, missingSince: null, employmentType,
} as unknown as PostingRow);
const SITE = "https://resumebooster.work";

describe("the 1,507 titles the bake has served", () => {
  it("is the corpus that was labelled: over 300 real titles, 51 of them a contract or a temporary job", () => {
    expect(CORPUS.titles.length).toBe(1507);
    expect(CORPUS.titles.filter((t) => t.types.length).length).toBe(51);
  });

  it("marks exactly the labelled titles, as labelled, and no other (never worse than main, which marked none)", () => {
    const wrong = CORPUS.titles.filter((t) => JSON.stringify(titleTypes(t.title)) !== JSON.stringify(t.types)).map((t) => `${t.title}: ${JSON.stringify(titleTypes(t.title))} want ${JSON.stringify(t.types)}`);
    expect(wrong).toEqual([]);
  });

  it("reads the job's terms, never the job area", () => {
    expect(titleTypes("Talent Acquisition Operations Specialist (Contract)")).toEqual(["CONTRACTOR"]);
    expect(titleTypes("Client Services Specialist |12 Month Contract")).toEqual(["CONTRACTOR"]);
    expect(titleTypes("Software Engineer - Contractor")).toEqual(["CONTRACTOR"]);
    expect(titleTypes("Retail Sales Associate (Seasonal)")).toEqual(["TEMPORARY"]);
    expect(titleTypes("Talent Sourcer (Temp Position)")).toEqual(["TEMPORARY"]);
    for (const t of ["Contracts Manager", "Market Access - Contract Operations Specialist", "Supplier/Contractor Qualification Specialist", "Government Contract Administrator", "Accountant (Temp to Perm)", "Temp Agency Recruiter", "Template Designer", "Temperature Control Technician"]) {
      expect(titleTypes(t), t).toEqual([]);
    }
  });
});

describe("the markup states the title's terms beside the employer's own type", () => {
  // AMD 100566 was served after this corpus was read: its title and its
  // stated type on a served row's place and description.
  const base = SERVED.find((r) => r.jp && !postingPage.postingInternshipTitle(r.title, r.description))!;
  const amd = { ...base, title: "Talent Acquisition Operations Specialist (Contract)" };

  it("AMD's '(Contract)' is PART_TIME and CONTRACTOR, not PART_TIME only", () => {
    const ld = postingPage.postingJsonLdShape(rowOf(amd, "part_time"), amd.description, { site: SITE });
    expect(ld).not.toBeNull();
    expect(asList(ld!.employmentType)).toEqual(["PART_TIME", "CONTRACTOR"]);
  });

  it("a seasonal title with no stated type is TEMPORARY, and an internship keeps INTERN", () => {
    const seasonal = SERVED.find((r) => r.path === "/jobs/posting/workday/newbalance~wd1~Careers/R41631")!;
    expect(postingPage.postingJsonLdShape(rowOf(seasonal), seasonal.description, { site: SITE })?.employmentType).toBe("TEMPORARY");
    const intern = SERVED.find((r) => r.jp && postingPage.postingInternshipTitle(r.title, r.description))!;
    expect(asList(postingPage.postingJsonLdShape(rowOf(intern, "full_time"), intern.description, { site: SITE })?.employmentType)).toEqual(["FULL_TIME", "INTERN"]);
  });

  it("never drops a type the served markup stated, on any of the served pages", () => {
    const dropped: string[] = [];
    for (const r of SERVED.filter((x) => x.jp)) {
      const before = asList(r.jp!.employmentType);
      if (!before.length) continue;
      // The served markup's first type is the stated one (the title's came after it).
      const stated = before[0] ?? null;
      const ld = postingPage.postingJsonLdShape(rowOf(r, stated ? stated.toLowerCase() : null), r.description, { site: SITE });
      const after = asList(ld?.employmentType);
      for (const t of before) if (ld && !after.includes(t)) dropped.push(`${r.path}: ${t}`);
    }
    expect(dropped).toEqual([]);
  });
});
