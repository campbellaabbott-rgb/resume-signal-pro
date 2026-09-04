// A CARD THAT NEVER SAYS WHAT KIND OF JOB IT IS.
//
// The board has let people FILTER by employment type since the filter shipped,
// and the server has emitted it on every row since the same day — rowToJob
// returns `employmentType: r.employment_type ?? null`. The client declared no
// such field and no surface rendered it, so `job.employmentType` appeared zero
// times in the app: a searcher could ask for internships and then read a page
// of results that never said which postings were one. Indeed and LinkedIn
// print Full-time/Contract/Internship on every card.
//
// The rule that makes this harder than "print the column": a field is shown
// only when the EMPLOYER stated it. An unstated type renders nothing — never
// an inferred "Full-time" — which is the same contract workMode and the agency
// badge already follow.
//
// Pinned against comment-stripped source (a guard literal inside a comment has
// passed while the code was dead five times in this repo) and behaviourally
// through the exported predicate.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isEmploymentType } from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const JOBS = strip(read("src/pages/Jobs.tsx"));
const BOARD = strip(read("supabase/functions/job-board/index.ts"));

const TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;

describe("a card that never says what kind of job it is", () => {
  it("the client declares the field the server has been sending all along", () => {
    // Same spelling as the wire, or the row arrives and nothing can read it.
    expect(BOARD, "the server emits it").toMatch(/employmentType: r\.employment_type \?\? null/);
    expect(JOBS, "and the client's row type finally declares it").toMatch(/employmentType\?: string \| null;/);
  });

  it("only the five values the filter offers are labelled — everything else, including null, renders nothing", () => {
    for (const t of TYPES) expect(isEmploymentType(t), t).toBe(true);
    // An unstated type is not "Full-time". These are the shapes a real row can
    // carry when the employer said nothing, plus values from outside the closed
    // list that must never reach a locale lookup as a raw column value.
    for (const v of [null, undefined, "", "FULL_TIME", "Full-time", "freelance", "fulltime", 1, {}]) {
      expect(isEmploymentType(v), String(v)).toBe(false);
    }
  });

  it("the card and the detail panel both render it, both through the predicate", () => {
    expect(JOBS, "the card").toMatch(/\{isEmploymentType\(job\.employmentType\) && \(/);
    expect(JOBS, "the detail panel").toMatch(/\{isEmploymentType\(detailJob\.employmentType\) && \(/);
    // The label comes from the keys the filter chips already use — one posting
    // must not be named two different ways by the chip and by the card.
    expect(JOBS).toMatch(/t\(`jobsPage\.employmentType\.\$\{job\.employmentType\}`/);
    expect(JOBS).toMatch(/t\(`jobsPage\.employmentType\.\$\{detailJob\.employmentType\}`/);
    // No render may key off the raw value without the predicate in front of it.
    for (const m of JOBS.matchAll(/t\(`jobsPage\.employmentType\.\$\{(\w+)\.employmentType\}`/g)) {
      expect(JOBS, `${m[1]}.employmentType labelled without the closed-list guard`)
        .toMatch(new RegExp(`isEmploymentType\\(${m[1]}\\.employmentType\\)`));
    }
  });

  it("one label list, not a second hand-typed copy per surface", () => {
    // The chip row carried the five English labels inline; adding the card
    // badge with its own copy is exactly how a chip and a card come to
    // disagree about the same posting.
    expect(JOBS).toMatch(/const EMPLOYMENT_TYPE_FALLBACK: Record<EmploymentTypeKey, string> = \{/);
    // "Part-time" as a literal now occurs once: in that map.
    expect((JOBS.match(/"Part-time"/g) ?? []).length, "a second inline label list has come back").toBe(1);
    expect((JOBS.match(/"Internship"/g) ?? []).length).toBe(1);
  });

  it("an employer-stated type reaches the JSON-LD in schema.org's own spelling, and an unstated one is omitted", () => {
    // Google reads FULL_TIME/PART_TIME/CONTRACTOR/TEMPORARY/INTERN and drops
    // anything else, so the column value cannot be emitted raw — and a guessed
    // FULL_TIME would be a fabricated claim published as structured data.
    expect(JOBS).toMatch(/const LD_EMPLOYMENT_TYPE: Record<EmploymentTypeKey, string> = \{/);
    for (const v of ["FULL_TIME", "PART_TIME", "CONTRACTOR", "TEMPORARY", "INTERN"]) {
      expect(JOBS, v).toContain(`"${v}"`);
    }
    expect(JOBS, "emitted only when the employer stated one")
      .toMatch(/\.\.\.\(isEmploymentType\(detailJob\.employmentType\)\s*\?\s*\{ employmentType: LD_EMPLOYMENT_TYPE\[detailJob\.employmentType\] \}/);
  });

  it("the five names and the provenance line exist in all nine locales", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as {
        jobsPage?: { employmentType?: Record<string, unknown>; employmentTypeProvenance?: unknown };
      };
      for (const t of TYPES) {
        expect(typeof j.jobsPage?.employmentType?.[t], `${f}: jobsPage.employmentType.${t}`).toBe("string");
      }
      // The badge is a claim about where the fact came from, so it carries the
      // same provenance sentence in every language rather than in English only.
      const prov = j.jobsPage?.employmentTypeProvenance;
      expect(typeof prov, `${f}: jobsPage.employmentTypeProvenance`).toBe("string");
      expect(String(prov).trim().length, `${f}: provenance must be a real translation`).toBeGreaterThan(20);
    }
  });
});
