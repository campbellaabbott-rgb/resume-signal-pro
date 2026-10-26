/**
 * A COMPANY PAGE WHOSE INTEL READ TIMED OUT, OR WAS NEVER MADE, IS STILL BAKED
 * (SEO round integration, 2026-10-24).
 *
 * The 2026-10-18 publish timed out in the get_company_intel phase, and Lovable
 * put a 90-second deadline on it (stop after 18 failures in a row as well).
 * The question after the publish was whether an employer whose read was cut
 * off lost its page. It does not: readCompanyIntel (scripts/prerender-pages.mjs,
 * the loop the bake runs) leaves that employer out of the intel map, and
 * companyLanderPage writes its page with its own title and openings and no
 * places or fields. The offline bake in seo-bake-crawler-output.test.ts reads
 * no intel at all and checks every chosen employer page is written.
 */
import { describe, expect, it } from "vitest";
import { companyLanderPage, landerFacts, readCompanyIntel } from "../../scripts/prerender-pages.mjs";
import { possessive } from "@/lib/company-display";

const tokens = Array.from({ length: 30 }, (_, i) => `board${i}`);
const intelFor = (t: string) => ({ countries: [{ country: "US", n: 40 }], categories: [{ category: "engineering", n: 30 }], token: t });

describe("readCompanyIntel keeps Lovable's deadline", () => {
  it("stops at the deadline and says how many employers it never asked", async () => {
    let clock = 0;
    const asked: string[] = [];
    const { intelOf, skipped } = await readCompanyIntel({
      tokens,
      deadlineMs: 90_000,
      now: () => clock,
      fetchIntel: async (t: string) => {
        asked.push(t);
        clock += 10_000; // 60 s a batch of six: the deadline has passed when the third batch would start
        return intelFor(t);
      },
    });
    expect(asked.length).toBe(12);
    expect(intelOf.size).toBe(12);
    expect(skipped).toBe(18);
  });

  it("stops after 18 failures in a row, and a success resets the run", async () => {
    let calls = 0;
    const res = await readCompanyIntel({
      tokens,
      fetchIntel: async () => {
        calls++;
        throw new Error("timeout");
      },
    });
    expect(calls).toBe(18);
    expect(res.skipped).toBe(12);

    let n = 0;
    const mixed = await readCompanyIntel({
      tokens,
      fetchIntel: async (t: string) => (n++ % 6 === 0 ? intelFor(t) : null),
    });
    expect(mixed.skipped).toBe(0);
    expect(mixed.intelOf.size).toBe(5);
  });

  it("an empty or array answer is a failure, not intel", async () => {
    const res = await readCompanyIntel({ tokens: ["a", "b"], fetchIntel: async (t: string) => (t === "a" ? [] : null) });
    expect(res.intelOf.size).toBe(0);
  });
});

describe("an employer with no intel still gets its page", () => {
  const page = (intel: unknown) => companyLanderPage({
    token: "andurilindustries", name: "Anduril Industries", primaryToken: "andurilindustries", openN: 801,
    facts: landerFacts(intel, { countryName: () => "United States", fieldLabel: () => "Engineering" }),
    openings: [{ title: "NDT Technician", place: "McHenry, Mississippi" }, { title: "Machinist", place: "Costa Mesa, California" }, { title: "Test Engineer", place: "Atlanta, Georgia" }],
    openingsAt: "2026-10-24", sources: "Greenhouse", boardCompanies: 29000,
    site: "https://resumebooster.work", esc: (s: string) => s, possessive, fmt: (n: number) => n.toLocaleString("en-US"),
    href: (t: string) => `/jobs/company/${t}`,
  });

  it("with its own title, path and openings, and no places or fields", () => {
    const p = page(undefined);
    expect(p.path).toBe("/jobs/company/andurilindustries");
    expect(p.title).toBe("Anduril Industries jobs: 801 open roles from their own hiring system");
    expect(p.robots).toBeNull();
    expect(p.content).toContain("NDT Technician");
    expect(p.content).not.toMatch(/The countries holding/);
    expect(p.content).not.toMatch(/The fields holding/);
  });

  it("and the same employer with intel states its places across its hiring system (positive control)", () => {
    const p = page(intelFor("andurilindustries"));
    expect(p.title).toBe("Anduril Industries jobs: 801 open roles from their own hiring system");
    expect(p.content).toMatch(/The countries holding the most of its roles across Anduril Industries' hiring system/);
    expect(p.content).not.toMatch(/on this board:/);
  });
});
