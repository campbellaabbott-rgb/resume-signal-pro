// @vitest-environment node
/**
 * AN INTERNSHIP SAYS INTERN (SEO audit 2026-11-18, STRUCTURED-9, optional).
 *
 * eppr 203746, "Emerging Technology & AI Internship", was marked up FULL_TIME
 * only: the markup's employmentType came from the stated time type alone.
 * A title that names an internship in the employer's own word now adds
 * INTERN. The corpus is the 492 served JobPosting titles
 * (fixtures/served-postings-2026-11-18.json.gz): the five that name one are
 * listed below, and no other title gains INTERN.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import type { PostingRow } from "@/components/jobs/posting-page";

type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string; jp: { employmentType: unknown } | null };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));
const SITE = "https://resumebooster.work";
const TYPE_OF: Record<string, string> = { FULL_TIME: "full_time", PART_TIME: "part_time", INTERN: "internship", CONTRACTOR: "contract", TEMPORARY: "temporary", PER_DIEM: "per diem" };
/** The row with the time type its markup was served with, posted yesterday. */
const rowOf = (r: Served): PostingRow => ({
  id: r.id, source: r.source, token: r.token, title: r.title, company: r.company,
  location: r.location, country: r.country, postedAt: new Date(Date.now() - 86_400_000).toISOString(),
  employmentType: typeof r.jp?.employmentType === "string" ? TYPE_OF[r.jp.employmentType] ?? null : null,
  applyUrl: null, salary: null, agency: false, workMode: null, missingSince: null,
} as unknown as PostingRow);
const typesOf = (ld: Record<string, unknown> | null) => {
  const t = ld?.employmentType;
  return Array.isArray(t) ? t : t ? [t] : [];
};

const NAMES_ONE = [
  "/jobs/posting/teamtailor/studiosantagostino-1746448557/8683522",
  "/jobs/posting/workday/levistraussandco~wd5~External/R-0159776",
  "/jobs/posting/oracle/eppr~us2~CX_2/203746",
  "/jobs/posting/workday/santander~wd3~SantanderCareers/Req0843024",
  "/jobs/posting/workday/labcorp~wd1~External/2640008",
];

describe("eppr 203746", () => {
  it("is FULL_TIME and INTERN", () => {
    const r = SERVED.find((x) => x.path === "/jobs/posting/oracle/eppr~us2~CX_2/203746")!;
    expect(r.jp?.employmentType).toBe("FULL_TIME");
    const ld = postingPage.postingJsonLdShape(rowOf(r), r.description, { site: SITE });
    expect(typesOf(ld)).toEqual(["FULL_TIME", "INTERN"]);
  });
});

describe("the 492 served JobPosting titles", () => {
  it("gain INTERN on the internships only: every other title's markup type is as served, or gains only its title's contract or season (STRUCTURED-B11)", () => {
    const gained: string[] = [];
    for (const r of SERVED.filter((x) => x.jp)) {
      const ld = postingPage.postingJsonLdShape(rowOf(r), r.description, { site: SITE });
      if (!ld) continue;
      const before = typeof r.jp!.employmentType === "string" ? [r.jp!.employmentType] : [];
      const now = typesOf(ld);
      // A contract or a seasonal title adds CONTRACTOR or TEMPORARY after the stated type.
      const fromTitle = postingPage.postingTitleEmploymentTypes(r.title).filter((t) => !before.includes(t));
      const expected = [...before, ...fromTitle];
      if (JSON.stringify(now) !== JSON.stringify(expected)) {
        expect(now, r.path).toEqual([...expected, "INTERN"]);
        gained.push(r.path);
      }
    }
    // santander's open application has no markup at all (STRUCTURED-5).
    expect(gained).toEqual(NAMES_ONE.filter((p) => !p.includes("santander")));
  });

  it("reads the word, never a part of another one or a rocket's stage", () => {
    const f = (postingPage as unknown as { postingInternshipTitle?: (t: string, d?: string) => boolean }).postingInternshipTitle;
    expect(typeof f).toBe("function");
    for (const t of ["Senior Internal Control", "International Sales Manager", "Management Trainee"]) expect(f!(t), t).toBe(false);
    const english = "We are building the next stage of our launch vehicle and you will analyse its structures with the team.";
    expect(f!("Structural Analyst III - New Glenn Stage 2", english)).toBe(false);
    expect(f!("Stage Manager", english)).toBe(false);
    for (const t of ["Praktikum Marketing (m/w/d)", "Intern-Assistant Scientist", "Stagiaire RH"]) expect(f!(t), t).toBe(true);
  });
});
