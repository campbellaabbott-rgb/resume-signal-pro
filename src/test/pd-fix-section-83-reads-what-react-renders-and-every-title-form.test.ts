// @vitest-environment node
/**
 * SECTION 83 READS WHAT REACT RENDERS, THE TRUST PAGES, AND EVERY TITLE FORM
 * THE BAKE WRITES (2026-10-18 review).
 *
 *   - C3 read only the pre-script H1, so it passed on a local bake while the
 *     rendered H1 said "The agent applies for you": React replaces the baked
 *     #root, and Googlebot runs scripts. C7 now reads the served entry, the
 *     English chunks and the Index chunk for the retired sentences. On
 *     production on 2026-10-18 (before this deploy) it found all eleven,
 *     which is its positive control.
 *   - C1 never read /trust, whose baked text said the agent applies to
 *     employers for you; it reads /trust, /privacy and /terms now.
 *   - C1's company-title check accepted only the full form, and about one
 *     page in five gets a shorter one from the 68-character budget.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyLanderPage } from "../../scripts/prerender-pages.mjs";

const SH = readFileSync(resolve(__dirname, "../../scripts/verify-deploy.d/83-profiles-design-bake.sh"), "utf8");
const TITLE_OK = (() => {
  const m = /const TITLE_OK = (\/.*\/);\n/.exec(SH);
  expect(m, "section 83 declares TITLE_OK").toBeTruthy();
  return new Function(`return ${m![1]};`)() as RegExp;
})();

describe("C1 accepts every company title form the bake writes, and no 'verified'", () => {
  const esc = (s: unknown) => String(s);
  const page = (name: string, openN: number | null, kind = "employer") => companyLanderPage({
    token: "t", name, primaryToken: "t", openN, facts: null, sources: "Workday", boardCompanies: null, site: "https://x",
    esc, possessive: (n: string) => `${n}'s`, fmt: (n: number) => n.toLocaleString("en-US"), href: (t: string) => `/jobs/company/${t}`, kind,
  }).title;
  it("full, short and bare employer titles, the agency form and the USAJOBS form all pass", () => {
    for (const t of [
      page("Domino's", 23791), page("Albertsons Companies", 6239), page("National Federation of Independent Business (NFIB)", 431),
      page("Acme", null), page("Surge Staffing", 308, "agency"), page("USAJOBS", 13926, "usajobs"),
    ]) expect(TITLE_OK.test(t), t).toBe(true);
    // The short form exists (the budget is real), so the old full-form-only check failed a correct deploy.
    expect(page("Albertsons Companies", 6239)).toBe("Albertsons Companies jobs: 6,239 open roles");
  });
  it("production's old titles fail", () => {
    for (const t of ["Domino's Jobs — 23,791 Verified Openings", "USAJOBS Jobs — 14,048 Verified Openings"]) expect(TITLE_OK.test(t), t).toBe(false);
  });
});

describe("C1 reads the trust pages and C7 reads the strings React renders", () => {
  it("C1's page list includes /trust, /privacy and /terms", () => {
    expect(SH).toMatch(/const pages = \["\/", "\/pricing", "\/agent", "\/agents", "\/guides", \.\.\.guides, "\/trust", "\/privacy", "\/terms", \.\.\.threeCompanies\];/);
  });
  it("C7 reads the entry, the English chunks and the Index chunk for each retired sentence the home, FAQ and trust strings carried", () => {
    expect(SH).toMatch(/\(\?:en\(\?:-GB\)\?\|Index\)-/);
    for (const s of ["The agent applies for you", "submits where employers allow", "Live job board + AI apply agent", "the agent can submit for you", "pass gives your agent", "where the apply agent prepares a shortlist", "To have your agent request applications", "the employers it applies to for you", "re-verified all day"]) {
      expect(SH, s).toContain(`"${s}"`);
    }
    // It cannot pass on an unread bundle: the headline must be found first.
    expect(SH).toMatch(/if \(!bundle\.includes\("Live jobs, straight from employers"\)\) out\("FAIL"/);
  });
  it("none of those sentences is left in this checkout's English strings or the home components", () => {
    const en = readFileSync(resolve(__dirname, "../i18n/locales/en.json"), "utf8");
    const hero = readFileSync(resolve(__dirname, "../components/HomeHero.tsx"), "utf8");
    const index = readFileSync(resolve(__dirname, "../pages/Index.tsx"), "utf8");
    const list = [...SH.matchAll(/^\s+"([^"]+)", (?:"[^"]+",? ?)+$/gm)].flatMap((m) => [...m[0].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
    expect(list.length, "the C7 list was read").toBeGreaterThanOrEqual(11);
    for (const s of list) {
      expect(en, `en.json still carries "${s}"`).not.toContain(s);
      expect(hero, `HomeHero.tsx still carries "${s}"`).not.toContain(s);
      expect(index, `Index.tsx still carries "${s}"`).not.toContain(s);
    }
  });
});
