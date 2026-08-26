import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * THE BOARD NOW PUBLISHES TWO COUNTS, AND THEY MUST NEVER TRADE PLACES.
 *
 *   coverage.open     550,378 — what a visitor can actually page to. THE headline.
 *   coverage.tracked  644,440 — the corpus including postings that have closed.
 *
 * The gap is ~91k withdrawn postings the table still holds because closure
 * history is the thing this product owns. Both numbers are true. Only one of
 * them is "live openings", and swapping them would overstate the searchable
 * board by 17% while the page's entire promise is that it does not do that.
 *
 * The specific failure this guards is not a swap someone makes on purpose — it
 * is `trackedTotal ?? totalAllCompanies`, a fallback that looks defensive and
 * quietly asserts the two are equal on every response where the count has not
 * been taken yet.
 */
const ROOT = resolve(__dirname, "../..");
const FN = readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8");
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const PAGE = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const PAGE_CODE = PAGE.replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
const MIG = (() => {
  const dir = resolve(ROOT, "supabase/migrations");
  const f = readdirSync(dir).filter((x) => x.endsWith(".sql"))
    .filter((x) => readFileSync(resolve(dir, x), "utf8").includes("FUNCTION public.refresh_headline_open")).sort().pop();
  return f ? readFileSync(resolve(dir, f), "utf8") : "";
})();
const MIG_CODE = MIG.split("\n").map((l) => (/^\s*--/.test(l) ? "" : l)).join("\n");

describe("two true numbers must not become one", () => {
  it("the headline still counts only what is servable", () => {
    expect(MIG_CODE).toMatch(/count\(\*\) FILTER \(/);
    expect(MIG_CODE).toMatch(/p\.missing_since IS NULL/);
    expect(MIG_CODE).toMatch(/p\.effective_posted >= now\(\) - interval '30 days'/);
  });

  it("tracked is the corpus, counted in the SAME scan", () => {
    // Two round trips to count two things about one table is one too many.
    expect(MIG_CODE).toMatch(/INTO v_open, v_tracked/);
    expect(MIG_CODE).toMatch(/'tracked', v_tracked/);
    expect(MIG_CODE).toMatch(/FROM public\.job_board_postings p;/);
  });

  it("tracked NEVER falls back to the servable count", () => {
    // The dangerous line is `trackedTotal ?? safeMetaTotal` — defensive-looking,
    // and it asserts the two are equal whenever the count is missing.
    expect(CODE, "trackedTotal falls back to the servable total")
      .not.toMatch(/trackedTotal\s*\?\?\s*safeMetaTotal|safeMetaTotal\s*\?\?\s*trackedTotal/);
    expect(PAGE_CODE, "the page substitutes one count for the other")
      .not.toMatch(/trackedTotal\s*\?\?\s*totalAllCompanies|totalAllCompanies\s*\?\?\s*trackedTotal/);
    // Absent means absent: omitted from the payload, not defaulted.
    expect(CODE).toMatch(/\.\.\.\(trackedTotal !== null \? \{ trackedTotal \} : \{\}\)/);
  });

  it("the headline line still renders the SERVABLE figure", () => {
    // countLine is the "live openings" sentence. It must keep reading the
    // servable total, whatever else is added to the page.
    expect(PAGE_CODE).toMatch(/jobsPage\.countLine[\s\S]{0,200}?total: data\.totalAllCompanies\.toLocaleString\(\)/);
  });

  it("tracked is labelled as including closed roles, never as openings", () => {
    const line = /trackedCorpus", "([^"]+)"/.exec(PAGE_CODE)?.[1] ?? "";
    expect(line, "no tracked-corpus copy found").not.toBe("");
    expect(line.toLowerCase()).toMatch(/closed/);
    // "live openings" is the headline's phrase and must not appear on this one.
    expect(line.toLowerCase(), "the tracked figure is described as live openings")
      .not.toMatch(/live opening/);
  });

  it("the string exists in every locale, not just inline English", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, string> };
      expect(j.jobsPage?.trackedCorpus, `${f} is missing jobsPage.trackedCorpus`).toBeTruthy();
    }
  });
});
