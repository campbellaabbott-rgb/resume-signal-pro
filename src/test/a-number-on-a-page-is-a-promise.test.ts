import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The homepage claimed the TRACKED total under the SERVABLE noun.
 *
 * "600,000+ Verified Openings" — in the <title>, the meta description, the og
 * and twitter cards, and the SPA head override — against a board serving
 * 560,321. The 600,000 was not invented: it is what the project's own
 * plusClaim rule yields for the TRACKED corpus (678,957). The number was right
 * and the noun was wrong, which overstates what a visitor can page to by about
 * a fifth, in the one tag every search result shows.
 *
 * Two rules come out of it, and this pins both:
 *   1. A corpus count is DERIVED or it is absent. Never a literal.
 *   2. No count beats a stale count. Every surface has count-free copy for
 *      when the read fails.
 *
 * The same shape had already been fixed once: use-board-totals was extracted
 * in 2026-08-13 because the homepage advertised a frozen "550,000+". The
 * literal grew back in a different file. That is why this is a test.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");

/**
 * Comments stripped — and this is load-bearing.
 *
 * The comments that explain this bug necessarily quote the numbers involved. A
 * scanner that read them would flag the fix as the defect, which is the false
 * positive this repo has shipped four times.
 */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ")      // block + JSX-comment bodies
   .replace(/<!--[\s\S]*?-->/g, " ")        // html comments
   .replace(/^\s*\/\/[^\n]*/gm, " ");       // line comments

/** Any "500,000+"-shaped corpus claim. */
const COUNT_LITERAL = /\b\d{3},\d{3}\+/;

describe("a number on a page is a promise", () => {
  it.each([
    ["index.html", "the static shell ships when the prerender does not run"],
    ["src/pages/Index.tsx", "the SPA head override is what a real visitor's tab says"],
    ["src/components/LiveMatches.tsx", "the report's board CTA"],
  ])("%s states no frozen corpus count", (file, why) => {
    const m = COUNT_LITERAL.exec(code(read(file)));
    expect(m?.[0], `${file}: ${why} — derive it or omit it`).toBeUndefined();
  });

  it("the homepage head derives both numbers and has count-free copy", () => {
    const c = code(read("src/pages/Index.tsx"));
    expect(c, "the head must read the live board").toMatch(/useBoardTotals\(\)/);
    // roundedFloor, never rounded-to-nearest: a rounded-UP figure claims roles
    // that do not exist, and "+" only reads as honest over a floor.
    expect(c).toMatch(/roundedFloor\(homeTotals\.jobs\)/);
    // The tracked figure is stated too — and named as tracked, not as openings.
    expect(c).toMatch(/roundedFloor\(homeTotals\.tracked\)/);
    expect(c).toMatch(/tracked including ones we have watched close/);
    // And a variant that needs no number at all.
    expect(c).toMatch(/"Resume Booster — Live Job Board: Verified Openings, Zero Ghost Jobs"/);
  });

  it("the hook exposes tracked as its own field, not as a bigger `jobs`", () => {
    const c = code(read("src/hooks/use-board-totals.ts"));
    expect(c).toMatch(/tracked: number \| null;/);
    // Zero is a failed read, not a total.
    expect(c).toMatch(/d\.trackedTotal > 0 \? d\.trackedTotal : null/);
  });

  it("the report CTA takes its count from a call it already makes", () => {
    // Stating the number must not cost the free-report page an extra board
    // round trip; the list response it already awaits carries `total`.
    const c = code(read("src/components/LiveMatches.tsx"));
    expect(c).toMatch(/setBoardTotal\(t0\)/);
    expect(c, "no second board call just to print a number").not.toMatch(/useBoardTotals\(/);
  });

  it("the agent's vendor count is interpolated, never spelled out", () => {
    // It said "four hiring systems — about 6% of the board" while
    // SENDABLE_VENDORS held FIVE and the live figure was 8.2%. Both numbers
    // wrong, in all nine locales, on the page that sells the feature.
    const c = code(read("src/pages/Jobs.tsx"));
    expect(c).toMatch(/agentPitchScopeLive[\s\S]{0,240}\{\{n\}\} hiring systems/);
    expect(c).toMatch(/n: agentReach\.vendors/);
    expect(c).toMatch(/pct: Math\.round\(reachPct\(agentReach\)\)/);
    expect(c, "and a variant with no numbers when the status read fails")
      .toMatch(/agentPitchScopePlain/);
  });

  it("the prerendered head publishes the SERVABLE count, not the tracked one", () => {
    // CAUGHT ONLY BY VERIFYING THE DEPLOY. The SPA head and index.html were
    // fixed, the served page still said "600,000+ Verified Openings" — because
    // get_job_board_facets CHANGED THE MEANING of `total` underneath this
    // script. It used to be the servable count (the committed snapshot still
    // holds that shape: total 567,936, no openTotal); it is now the tracked
    // corpus, with the servable count moved to `openTotal`. Measured
    // 2026-08-27: total 683,478, openTotal 561,980, board serving 561,965.
    //
    // The line kept working and silently started publishing the wrong number,
    // in the one tag every search result shows.
    const c = code(read("scripts/prerender-seo.mjs"));
    // Resolved by SHAPE, so the old snapshot still reads correctly.
    expect(c).toMatch(/const FACETS_NEW_SHAPE = typeof boardFacets\?\.openTotal === "number";/);
    expect(c).toMatch(/const BOARD_TOTAL = FACETS_NEW_SHAPE\s*\n?\s*\? boardFacets\.openTotal/);
    // The tracked figure comes from the SAME payload — it was a separate fetch
    // against a meta key nothing is currently writing, so it was null every bake.
    expect(c).toMatch(/const BOARD_TRACKED = FACETS_NEW_SHAPE && typeof boardFacets\?\.total === "number"/);
    // And nothing may read the raw `total` for a servable claim any more.
    expect(c, "a servable claim must never read boardFacets.total directly")
      .not.toMatch(/plusClaim\(\s*(?:Number\()?boardFacets\??\.total/);
  });

  it("declares the shape flag before the constants that read it", () => {
    // BOARD_TRACKED referenced FACETS_NEW_SHAPE from above its declaration on
    // the first cut — a temporal dead zone throw, which is exactly how ranked
    // search went down silently in the edge function.
    const c = code(read("scripts/prerender-seo.mjs"));
    const flag = c.indexOf("const FACETS_NEW_SHAPE");
    expect(flag).toBeGreaterThan(-1);
    for (const name of ["const BOARD_TOTAL", "const BOARD_TRACKED"]) {
      expect(c.indexOf(name), `${name} must come after FACETS_NEW_SHAPE`).toBeGreaterThan(flag);
    }
  });

  it("the stale vendor sentence is deleted from every locale, not just English", () => {
    // A locale value OVERRIDES an inline default, so editing the English
    // default alone would have left nine translated copies of "four" rendering.
    for (const loc of ["en", "en-GB", "de", "es", "fr", "nl", "pt", "hi", "tl"]) {
      const j = JSON.parse(read(`src/i18n/locales/${loc}.json`)) as
        { jobsPage?: Record<string, string> };
      expect(j.jobsPage?.agentPitchScope, `${loc} still carries the old sentence`).toBeUndefined();
      expect(j.jobsPage?.agentPitchScopeLive, `${loc} is missing the new one`).toBeTruthy();
      expect(j.jobsPage!.agentPitchScopeLive, `${loc} must interpolate the count`).toContain("{{n}}");
    }
  });
});
