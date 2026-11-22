// @vitest-environment node
/**
 * A JOB TYPE THE MARKUP STATES IS PRINTED ON THE PAGE (SEO audit 2026-11-18,
 * STRUCTURED-B18).
 *
 * Eight of eight marked-up posting pages sampled carried an employmentType in
 * their JobPosting that the served page printed nowhere: React printed it only
 * after a call to the board, and Google's content policy asks that what the
 * markup says be visible. The bake now prints "Job type: ..., as the
 * employer's own posting states it." from the markup it writes, with the
 * board's own labels, so the two cannot disagree. (The built-output check in
 * sitemap-prerender-parity.test.ts reads every built page the same way.)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import type { PostingRow } from "@/components/jobs/posting-page";
import { EMPLOYMENT_TYPE_FALLBACK } from "@/lib/listing/types";

type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string; jp: { employmentType?: unknown } | null };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));
const BAKE = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const rowOf = (r: Served, employmentType: string | null): PostingRow => ({
  id: r.id, source: r.source, token: r.token, title: r.title, company: r.company,
  location: r.location, country: r.country, postedAt: new Date(Date.now() - DAY).toISOString(),
  applyUrl: null, salary: null, agency: false, workMode: null, missingSince: null, employmentType,
} as unknown as PostingRow);
/** Read through the namespace so this file fails, not breaks, on a main without it. */
const typeLine = (ld: Record<string, unknown> | null): string => {
  const f = (postingPage as unknown as { postingEmploymentTypeLine?: (ld: unknown) => string }).postingEmploymentTypeLine;
  return typeof f === "function" ? f(ld) : "";
};
const LABEL: Record<string, string> = {
  FULL_TIME: EMPLOYMENT_TYPE_FALLBACK.full_time, PART_TIME: EMPLOYMENT_TYPE_FALLBACK.part_time, CONTRACTOR: EMPLOYMENT_TYPE_FALLBACK.contract,
  TEMPORARY: EMPLOYMENT_TYPE_FALLBACK.temporary, INTERN: EMPLOYMENT_TYPE_FALLBACK.internship, VOLUNTEER: "Volunteer", PER_DIEM: "Per diem",
};

describe("the line the posting page prints", () => {
  it("names each type the markup states, with the board's labels, and nothing when it states none", () => {
    expect(typeLine({ employmentType: "FULL_TIME" })).toBe("Job type: Full-time, as the employer's own posting states it.");
    expect(typeLine({ employmentType: ["PART_TIME", "CONTRACTOR"] })).toBe("Job type: Part-time, Contract, as the employer's own posting states it.");
    expect(typeLine({})).toBe("");
    expect(typeLine(null)).toBe("");
  });

  it("prints every type of every served page's markup, its title's contract and season included", () => {
    const missing: string[] = [];
    let typed = 0;
    for (const r of SERVED.filter((x) => x.jp?.employmentType)) {
      const stated = [r.jp!.employmentType].flat().map(String)[0] ?? null;
      const ld = postingPage.postingJsonLdShape(rowOf(r, stated ? stated.toLowerCase() : null), r.description, { site: SITE });
      if (!ld?.employmentType) continue;
      typed++;
      const line = typeLine(ld);
      for (const t of [ld.employmentType].flat().map(String)) if (!line.includes(LABEL[t] ?? `?${t}`)) missing.push(`${r.path}: ${t} not in "${line}"`);
    }
    expect(typed).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });
});

describe("the bake prints it", () => {
  it("computes the line from the markup it writes, beside the employer and place", () => {
    expect(BAKE).toMatch(/const typeLine = D\.postingEmploymentTypeLine\(ld\);/);
    expect(BAKE).toMatch(/<h1>\$\{esc\(title\)\}<\/h1>\n\s+<p>[^\n]+<\/p>\n\s+\$\{typeLine \? `<p>\$\{esc\(typeLine\)\}<\/p>` : ""\}/);
    expect(BAKE).toMatch(/export \{[^}]*\bpostingEmploymentTypeLine\b[^}]*\} from "\.\.\/src\/components\/jobs\/posting-page";/);
  });
});
