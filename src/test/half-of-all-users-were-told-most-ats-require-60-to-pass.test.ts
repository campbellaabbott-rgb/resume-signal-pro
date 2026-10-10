import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { scoreBannerLine } from "@/lib/score-banner";
import { LANGUAGE_COUNT } from "@/i18n";

/**
 * Four small claims the code could not back, each measured in a register:
 *
 *  - L4-06: the free report told everyone under 60 "Most ATS require 60+ to
 *    pass" and everyone from 60 to 74 "75+ increases callback rate". The
 *    corpus median is 58 (get_public_scan_insights, n=379), so about half of
 *    all users read a pass mark the site's own guides call a myth; the
 *    /resume-score FAQ said "most resumes land in the 55–75 range" (a third do).
 *  - S8-113: the account page and the /agent copy said "you always press send"
 *    and the crawler copy said the agent "submits real applications", while
 *    apply_mode defaults to 'review' and auto is opt-in. Both were wrong half
 *    the time.
 *  - L9-11: /data-api and llms-full said a live pass raises the free key's
 *    /v1 limits; the overlay applies only to /mcp/ endpoints.
 *  - L4-09: "59 industries, 10 languages" over a table of 58 and eight
 *    languages (the list holds ten codes, two of them regional variants).
 */

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const LOCALES = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
const bench = { n: 379, median: 58, p25: 49, p75: 78, industry: "software_engineering" };

describe("the score banner places a score in the real distribution, never against a pass mark", () => {
  it("a 55 is below this industry's median, a 62 below its top quarter", () => {
    expect(scoreBannerLine(55, bench)).toEqual({ key: "freeResults.atsBanner.belowMedian", vars: { median: 58, p75: 78, n: "379", industry: "software engineering" } });
    expect(scoreBannerLine(62, bench).key).toBe("freeResults.atsBanner.belowTopQuarter");
  });

  it("with no distribution large enough to read, it says only that the score is no pass mark", () => {
    expect(scoreBannerLine(40, null).key).toBe("freeResults.atsBanner.noPassMark");
    expect(scoreBannerLine(40, { ...bench, n: 12 }).key).toBe("freeResults.atsBanner.noPassMark");
  });

  for (const file of LOCALES) {
    it(`${file}: the banner keys exist and none states a pass mark`, () => {
      const b = JSON.parse(read(`src/i18n/locales/${file}`)).freeResults.atsBanner;
      expect(Object.keys(b).sort()).toEqual(["belowMedian", "belowTopQuarter", "noPassMark", "topQuarter"]);
      expect(b.belowMedian).toContain("{{median}}");
      expect(JSON.stringify(b)).not.toMatch(/\b60\b|\b75\b/);
    });
  }

  it("the FAQ points at the live distribution instead of typing a range", () => {
    expect(codeOf(read("src/data/tool-landings.ts"))).not.toMatch(/55[–-]75/);
  });
});

describe("the agent copy says review is the default and auto is a switch", () => {
  for (const file of LOCALES) {
    it(`${file}: no line says you always press send`, () => {
      const d = JSON.parse(read(`src/i18n/locales/${file}`));
      for (const s of [d.accountPage.bridgeBlurb, d.applyAgent.control]) {
        expect(s).not.toMatch(/always press send|Absenden tust immer du|siempre pulsas enviar|toujours vous qui envoyez|भेजते हमेशा आप|Versturen doe jij altijd|sempre aperta enviar|laging magpapadala/);
      }
    });
  }

  it("the crawler copy of /agent no longer says it submits unattended", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    const at = bake.indexOf('path: "/agent",');
    const block = bake.slice(at, bake.indexOf("write({", at + 10));
    expect(block).not.toMatch(/submits real applications/);
    expect(block).toMatch(/In review mode, the default, nothing is sent until you approve it/);
  });
});

describe("the pass's limits are stated where they apply", () => {
  it("the free-key sentence scopes the pass to the MCP server and denies it on /v1", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    const m = /const FREE_KEY_RATE_SENTENCE = `([^`]+)`;/.exec(bake);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/on the MCP server, a live Agent Pass/);
    expect(m![1]).toMatch(/never raises them on \/v1/);
  });
});

describe("counts are derived, never typed", () => {
  it("the interface language count is the distinct languages the locale files carry", () => {
    expect(LANGUAGE_COUNT).toBe(new Set(LOCALES.map((f) => f.split(/[-.]/)[0])).size);
    expect(LANGUAGE_COUNT).toBe(8);
  });

  it("no homepage section or /industries types an industry or language count", () => {
    for (const f of ["src/components/SocialProof.tsx", "src/components/WhatYouGetSection.tsx", "src/pages/IndustriesIndex.tsx"]) {
      expect(codeOf(read(f)), f).not.toMatch(/\b5\d industries\b|\b1\d languages\b|\b5\d Fields\b/);
    }
  });
});
