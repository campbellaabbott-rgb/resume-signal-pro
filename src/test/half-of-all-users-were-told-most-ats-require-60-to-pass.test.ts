import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
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
// The banner said for a while where the score sat in this industry's own
// scanned distribution (a median and a top quarter). That placed the reader
// among other people's scans, which the free report no longer does (H0, the
// review of 2026-10-27): under 75 the banner now says only that the score is
// no pass mark, for everyone.
describe("the score banner never states a pass mark and places the score among no one", () => {
  for (const file of LOCALES) {
    it(`${file}: the banner says the score is no pass mark, and none of its keys states a pass mark or a placement`, () => {
      const b = JSON.parse(read(`src/i18n/locales/${file}`)).freeResults.atsBanner;
      expect(Object.keys(b).sort()).toEqual(["heading", "noPassMark"]);
      expect(JSON.stringify(b)).not.toMatch(/\b60\b|\b75\b|\{\{(?:median|p75|n)\}\}/);
    });
  }

  it("the report prints the no-pass-mark line itself, with no placement", () => {
    const report = codeOf(read("src/components/FreeKeywordResults.tsx"));
    expect(report).toContain("t('freeResults.atsBanner.noPassMark')");
    expect(report).not.toMatch(/scoreBannerLine|atsBanner\.(?:belowMedian|belowTopQuarter|topQuarter)/);
  });

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

  // Reviewer, 2026-10-10: S8-113 cited two lines and only one was changed.
  // The saved-job toast (jobsPage.savedMilestoneDesc, the Apply Agent upsell)
  // still ended "and you always hit send yourself" in every locale, which
  // auto mode contradicts. It now says what the account page says.
  // The saved-job toast sold the Apply Agent's trial; the agent is retired
  // (the apply pivot, 2026-10-11) and the toast with it (pass B, 2026-10-12):
  // a save now only says where the posting went.
  for (const file of LOCALES) {
    it(`${file}: the saved-job toast that sold the retired agent is gone`, () => {
      const d = JSON.parse(read(`src/i18n/locales/${file}`));
      expect(d.jobsPage.savedMilestoneDesc, `${file} still carries the agent upsell`).toBeUndefined();
      expect(d.jobsPage.savedMilestone).toBeUndefined();
    });
  }
  it("the board's save confirms the save and pitches nothing", () => {
    const jobs = codeOf(read("src/pages/Jobs.tsx"));
    expect(jobs).not.toMatch(/savedMilestone/);
    expect(jobs).toMatch(/toast\(\{ title: t\("jobsPage\.jobSaved", "Saved to your application tracker"\) \}\);/);
  });

  it("the crawler copy of /agent no longer says it submits unattended", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    const at = bake.indexOf('path: "/agent",');
    const block = bake.slice(at, bake.indexOf("write({", at + 10));
    expect(block).not.toMatch(/submits real applications/);
    // The apply pivot (2026-10-11): /agent says how to apply with your own AI
    // and offers no mode at all (its "retired" wording waits for wave 4).
    expect(block).toMatch(/Apply with your own AI/);
    expect(block).not.toMatch(/review mode|auto mode/i);
  });
});

describe("the retired pass is named nowhere in the free-key sentence", () => {
  it("the free-key sentence states the key's two limits and no pass", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    const m = /const FREE_KEY_RATE_SENTENCE = `([^`]+)`;/.exec(bake);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/requests a minute and .* calls a day per key/);
    expect(m![1]).not.toMatch(/pass/i);
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

  // S11-151: the corrected count had not reached /vs/kickresume, the
  // homepage's WebApplication JSON-LD, or the Spanish /es/revisar-curriculum.
  it("the /vs rows, the Spanish tool landing and the SPA JSON-LD print the derived language count", async () => {
    const { COMPETITORS } = await import("@/data/competitors");
    const { TOOL_LANDINGS } = await import("@/data/tool-landings");
    const langRows = Object.values(COMPETITORS).flatMap((c) => c.rows).filter((r) => /language/i.test(r.dim));
    expect(langRows.length).toBeGreaterThan(0);
    for (const r of langRows) {
      expect(r.us).toContain(`${LANGUAGE_COUNT} languages`);
      expect(r.us).not.toMatch(/\b10 languages\b/);
    }
    const es = Object.values(TOOL_LANDINGS).find((l) => l.lang === "es");
    expect(es?.bullets.join("\n")).toContain(`${LANGUAGE_COUNT} idiomas`);
    expect(JSON.stringify(TOOL_LANDINGS)).not.toMatch(/\b10 (idiomas|languages)\b/);
    for (const f of ["src/data/competitors.ts", "src/data/tool-landings.ts", "src/pages/Index.tsx"]) {
      expect(codeOf(read(f)), f).not.toMatch(/\b\d+ (languages|idiomas|Sprachen|langues|talen|lingue)\b/);
    }
    expect(codeOf(read("src/pages/Index.tsx"))).toMatch(/industries, with an interface in \$\{LANGUAGE_COUNT\} languages/);
  });
});
