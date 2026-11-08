/**
 * THE GHOST JOB INDEX ANSWERS ITS TITLE'S QUESTION IN ITS FIRST SENTENCE, UNDER
 * ITS BRAND (GEO-1107-05), AND REACT KEEPS THE DATED HEAD THE BAKE WROTE
 * (GEO-1107-04).
 *
 * On 2026-11-07 /ghost-job-index was titled "The Ghost Job Index — how many
 * job postings are actually real?" and opened on a definition of ghost jobs:
 * an answer engine quoting its first sentence quoted no figure, and the name
 * it quoted was nobody's. Its React head then replaced the bake's dated figure
 * line with undated copy that said the page shows "which employers actually
 * fill roles" (a takedown is never a fill) and, in its closing note, that a
 * posting is logged "the moment" a company takes it down (the log runs on the
 * next read of that feed, hours later on the page's own figures).
 *
 * The bake now prints the brand in the title and H1 and, when it read the
 * figures, one dated sentence that answers the title from figures the page
 * already prints. The answer is built inside the self-contained figure
 * builder, so this test runs the builder, as
 * a-data-page-that-serves-no-number-is-an-empty-page does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const BAKE = read("scripts/prerender-seo.mjs");
const BAKE_CODE = codeOf(BAKE);

type Figures = { html: string; desc: string | null; read: boolean; answer?: string | null };
function build(payload: unknown): Record<"ghost" | "entry" | "trends" | "pay", Figures> {
  const a = BAKE.indexOf("// >>> DATA-PAGE FIGURE BUILDER START");
  const b = BAKE.indexOf("// <<< DATA-PAGE FIGURE BUILDER END");
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  // eslint-disable-next-line no-new-func
  const [fn] = new Function(`${BAKE.slice(a, b)}; return [dataPageFigures];`)();
  return fn(payload);
}

/** The ghost figures' shape as the board returns them (the 2026-09-23 values the figure-builder test uses). */
const PAYLOAD = {
  stats: {
    computed_at: "2026-09-23T17:12:00.019780+00:00",
    stale_parts: [] as string[],
    ghost_stats: {
      total_open: 770989,
      total_companies: 32301,
      total_company_names: 31482,
      closed_90d: 1543884,
      observed_days: 71,
      median_days_open: 13.7,
      median_days_to_close: 12.5,
      posted_coverage_pct: 99.5,
      computed_at: "2026-09-23T17:05:00.019645+00:00",
    },
  },
  freshness: { boards: 32303, p50_min: 173.4, p95_min: 387.3, max_min: 3609.4, computed_at: "2026-09-23T17:15:00.029989+00:00" },
  audit: { at: "2026-09-23T06:00:00Z", accuracyPct: 96.6, sampled: 120, decided: 117, live: 113 },
};

describe("the answer sentence", () => {
  const ghost = build(PAYLOAD).ghost;

  it("opens on the measurement's date and answers with the count the page prints", () => {
    expect(ghost.answer).toBeTruthy();
    expect(ghost.answer!.startsWith("Measured 2026-09-23 17:05 UTC, this board holds 770,989 open roles,")).toBe(true);
    expect(ghost.answer).toContain("no dated posting older than 30 days");
    expect(ghost.answer).toContain("their median age is 13.7 days by the date the employer itself put on them (99.5% state one)");
    expect(ghost.html).toContain("770,989");
  });

  it("states the re-check's share only beside its sample, its interval and how it was drawn", () => {
    expect(ghost.answer).toMatch(/In the daily re-check on 2026-09-23, 96\.6% of 117 sampled postings that could be decided were still live at the employer's own source \(95% interval [\d.]+–[\d.]+%; drawn evenly across hiring systems/);
  });

  it("is absent when the figures were not read: no number it could not source", () => {
    expect(build({}).ghost.answer ?? null).toBeNull();
    expect(build({ stats: { ghost_stats: {} } }).ghost.answer ?? null).toBeNull();
  });

  it("calls no takedown a fill or a hire", () => {
    expect(ghost.answer).not.toMatch(/\bfill|\bhire/i);
  });
});

describe("the baked page", () => {
  const block = BAKE_CODE.slice(BAKE_CODE.indexOf('path: "/ghost-job-index"'), BAKE_CODE.indexOf('path: "/ghost-job-index"') + 4000);

  it("carries the brand in its title and H1, and its title fits the snippet", () => {
    const title = "Resume Booster Ghost Job Index: how many postings are real?";
    expect(title.length).toBeLessThanOrEqual(60);
    expect(block).toContain(`title: "${title}"`);
    expect(block).toContain("<h1>Resume Booster Ghost Job Index</h1>");
  });

  it("prints the answer as the first paragraph under the H1", () => {
    const h1 = block.indexOf("<h1>Resume Booster Ghost Job Index</h1>");
    const ans = block.indexOf("DATA_FIGURES.ghost.answer ?");
    expect(ans).toBeGreaterThan(h1);
    expect(block.slice(h1, ans)).not.toMatch(/<p\b/);
  });
});

describe("the React page", () => {
  const page = codeOf(read("src/pages/GhostJobIndex.tsx"));

  it("names the index under its brand in the H1 and in every language's title", () => {
    expect(page).toMatch(/<h1[^>]*>Resume Booster Ghost Job Index<\/h1>/);
    for (const l of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const g = JSON.parse(read(`src/i18n/locales/${l}.json`)).ghostIndex;
      expect(g.seoTitle, l).toContain("Resume Booster");
      expect(g.seoTitle.length, `${l}: ${g.seoTitle}`).toBeLessThanOrEqual(60);
      expect(g.seoDescription.length, l).toBeLessThanOrEqual(160);
    }
  });

  it("says no takedown is logged the moment it happens, and calls none a fill", () => {
    expect(page).not.toMatch(/the moment a company/i);
    expect(page).not.toMatch(/actually fill/i);
    for (const l of ["en", "en-GB"]) {
      const g = JSON.stringify(JSON.parse(read(`src/i18n/locales/${l}.json`)).ghostIndex);
      expect(g, l).not.toMatch(/the moment|actually fill|roles are actually filled/i);
    }
  });
});

describe("React keeps the dated head the bake wrote (GEO-1107-04)", () => {
  it.each([
    "src/pages/GhostJobIndex.tsx",
    "src/pages/HiringTrends.tsx",
    "src/pages/EntryLevelIndex.tsx",
    "src/pages/PayTransparencyIndex.tsx",
    "src/pages/ScoreStudy.tsx",
    "src/pages/Companies.tsx",
    "src/pages/AgentConnect.tsx",
    "src/pages/Explore.tsx",
  ])("%s asks for the baked head", (file) => {
    expect(codeOf(read(file))).toMatch(/<SEO\b[^>]*\bpreferBakedHead\b/);
  });
});
