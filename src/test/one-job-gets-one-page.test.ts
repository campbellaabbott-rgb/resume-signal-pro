// @vitest-environment node
/**
 * ONE JOB GETS ONE PAGE (SEO audit 2026-11-18, CONTENT-9).
 *
 * Rule 4 gives one page per identity, and the identity was exact: the
 * printed company, title and place, or the requisition key under one
 * employer. Two pairs of served pages were one job each: think-cell's
 * "Customer Success Manager (m/f/d), Strategic Accounts" in Berlin under two
 * Greenhouse boards, eu~thinkcellsoftware 5013527101 ("think-cell Software")
 * and eu~think-cell 5008812101 ("think-cell"); and ABB's "R&D Lead Software
 * Develper" (JR00050697-3) and "R&D Lead Software Developer" (JR00050703) in
 * Hangzhou, with the same description. Each spent two of the bake's slots on
 * one opening, and Google for Jobs folds duplicate JobPostings.
 *
 * D.postingSameJob widens the identity (same employer, same place, a title a
 * typo apart, descriptions 0.95 the same) and the bake's claims ask it
 * (postingIdentityClaims): the page claimed first keeps the job, a carried
 * twin becomes a retired stub naming it, a new twin gets no page. Corpus:
 * every pair of the 500 served pages (fixtures/served-postings-2026-11-18.json.gz).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import * as bakeModule from "../../scripts/prerender-seo.mjs";

type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));
const D = { ...companyDisplay, ...postingPage } as Record<string, unknown>;
const byPath = (p: string) => {
  const r = SERVED.find((x) => x.path === `/jobs/posting/${p}`);
  if (!r) throw new Error(`no served page ${p}`);
  return r;
};
const jobOf = (r: Served) => ({ id: r.id, source: r.source, token: r.token, title: r.title, company: r.company, location: r.location, country: r.country });

type SameJob = (a: { job: unknown; description: string }, b: { job: unknown; description: string }) => boolean;
const sameJob: SameJob = (a, b) => {
  const f = (postingPage as unknown as { postingSameJob?: SameJob }).postingSameJob;
  return typeof f === "function" ? f(a, b) : false;
};
type Claims = { takenBy: (job: unknown, description?: string | null) => string | null; claimIdentity: (job: unknown, path: string, description?: string | null) => void };
/** The bake's claims; on a main without them, its exact keys alone (which is what main did). */
const claimsOf = (): Claims => {
  const f = (bakeModule as unknown as { postingIdentityClaims?: (d: unknown) => Claims }).postingIdentityClaims;
  if (typeof f === "function") return f(D);
  const taken = new Map<string, string>();
  const keys = (j: unknown) => [postingPage.postingIdentity(j as never), postingPage.postingRequisitionIdentity(j as never)].filter(Boolean) as string[];
  return {
    takenBy: (j) => { for (const k of keys(j)) if (taken.has(k)) return taken.get(k)!; return null; },
    claimIdentity: (j, p) => { for (const k of keys(j)) taken.set(k, p); },
  };
};

const THINKCELL = ["greenhouse/eu~thinkcellsoftware/5013527101", "greenhouse/eu~think-cell/5008812101"];
const ABB = ["workday/abb~wd3~external_career_page/JR00050697-3", "workday/abb~wd3~external_career_page/JR00050703"];

/** Rule 4 over carried pages in order, as the bake's carried loop runs it. */
function bakeCarried(paths: string[]) {
  const claims = claimsOf();
  const live: string[] = [];
  const stubs: Array<{ path: string; duplicateOf: string }> = [];
  for (const p of paths) {
    const r = byPath(p);
    const twin = claims.takenBy(jobOf(r), r.description);
    if (twin) { stubs.push({ path: r.path, duplicateOf: twin }); continue; }
    claims.claimIdentity(jobOf(r), r.path, r.description);
    live.push(r.path);
  }
  return { live, stubs };
}

describe("the two pairs the audit names", () => {
  it("think-cell 5013527101 and 5008812101 are one page", () => {
    const { live, stubs } = bakeCarried(THINKCELL);
    expect(live).toEqual([`/jobs/posting/${THINKCELL[0]}`]);
    expect(stubs).toEqual([{ path: `/jobs/posting/${THINKCELL[1]}`, duplicateOf: `/jobs/posting/${THINKCELL[0]}` }]);
  });

  it("ABB JR00050697-3 and JR00050703 are one page", () => {
    const { live, stubs } = bakeCarried(ABB);
    expect(live).toEqual([`/jobs/posting/${ABB[0]}`]);
    expect(stubs.map((s) => s.duplicateOf)).toEqual([`/jobs/posting/${ABB[0]}`]);
  });

  it("the bake's carried loop and its new postings ask the same claims, with the description", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/const \{ takenBy, claimIdentity, sameJobAs, claimedJobs \} = postingIdentityClaims\(D\);/);
    expect(src).toMatch(/const twin = takenBy\(c\.job, c\.description\);/);
    expect(src).toMatch(/claimIdentity\(c\.job, path, c\.description\);/);
    expect(src).toMatch(/if \(sameJobAs\(c\.job, c\.description\)\) \{ freshSameJob\+\+; continue; \}/);
    expect(src).toMatch(/export \{[^}]*\bpostingSameJob\b[^}]*\} from "\.\.\/src\/components\/jobs\/posting-page";/);
  });
});

describe("every pair of the 500 served pages", () => {
  it("merges exactly the two pairs, and no other (never worse)", () => {
    const merged: string[][] = [];
    for (let i = 0; i < SERVED.length; i++) {
      for (let j = i + 1; j < SERVED.length; j++) {
        const a = SERVED[i];
        const b = SERVED[j];
        if (sameJob({ job: jobOf(a), description: a.description }, { job: jobOf(b), description: b.description })) merged.push([a.path, b.path]);
      }
    }
    expect(merged.map((p) => p.map((x) => x.replace("/jobs/posting/", "")).sort()).sort()).toEqual([[...ABB].sort(), [...THINKCELL].sort()].sort());
  });

  it("keeps apart two shifts of one role at two rates of pay, and two levels", () => {
    const suddath = ["workday/suddath~wd5~Suddath/R12265-1", "workday/suddath~wd5~Suddath/R12268-1"].map(byPath);
    expect(suddath.map((r) => r.title)).toEqual(["Equipment Operator - 2nd. Shift", "Equipment Operator - 3rd. Shift"]);
    expect(sameJob({ job: jobOf(suddath[0]), description: suddath[0].description }, { job: jobOf(suddath[1]), description: suddath[1].description })).toBe(false);
    const r = byPath(ABB[1]);
    expect(sameJob({ job: jobOf(r), description: r.description }, { job: { ...jobOf(r), title: "R&D Lead Software Developer II" }, description: r.description })).toBe(false);
    // One opening under two employers is never merged on its text alone.
    expect(sameJob({ job: jobOf(r), description: r.description }, { job: { ...jobOf(r), token: "acme~wd1~careers", company: "Acme" }, description: r.description })).toBe(false);
  });
});
