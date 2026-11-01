/**
 * EVERY BOX TICKED IN THE SIMULATOR LANDS ON THE PROJECTED SCORE
 * (register S13-058, where the engine half meets the page half).
 *
 * The engine (fix/free-scan-wave) now builds one fix list and reads every
 * projection from it: the hero's projectedScore, the Fix Plan's last step and
 * Improvement Potential. It sends the list as scoreProjection.fixes so the
 * "What happens if you fix it?" simulator can tick through the same fixes.
 * The page still built the simulator from the quick wins alone, so with every
 * box ticked it stopped short of the hero by the bullets and keywords steps:
 * a fourth projection on the same report. This holds the simulator to the
 * engine's list.
 *
 * Review fix (2026-11-01). The simulator capped the score at 95 but printed
 * the uncapped sum: a 92 with three boxes ticked read "Projected: 95 (+13
 * points)", and a 98 read "Projected: 95 (+6 points)", below its own score.
 * It now reads max(score, min(95, score + ticked)) with the engine's own
 * constant, prints that gain, and says there is no gain left when the cap
 * leaves none. On the synthetic corpus below (640 cases) the old card printed
 * a wrong gain on the 396 where the cap binds; the card now prints the
 * engine's projection on all 640. The scanner's own fix steps and
 * the hero's projection line are said in the reader's language (S13-122).
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { ScoreSimulatorCard } from "@/components/ReportInsightCards";
import { PROJECTION_CEILING, applyScoreProjection, buildScoreProjection } from "../../supabase/functions/free-keyword-scan/score-projection";
import { fixLabel } from "@/lib/fix-labels";
import { codeOf } from "./helpers/strip-comments";
import i18next from "i18next";
import en from "@/i18n/locales/en.json";
import de from "@/i18n/locales/de.json";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const QUICK_WINS = [
  { fix: "Add your LinkedIn URL to the contact line", timeEstimate: "2 min", impact: "medium" as const },
  { fix: "Move Skills above Education", timeEstimate: "5 min", impact: "low" as const },
  { fix: "Name the ward size in your current role", timeEstimate: "10 min", impact: "high" as const },
];

/** A report as the primary scanner writes it: one projection, applied. */
function scannedReport(score: number) {
  const report: Record<string, unknown> = {
    atsScoreEstimate: score,
    quickWins: QUICK_WINS.map((w) => ({ ...w })),
    improvementPotential: { level: "medium", estimatedScoreIncrease: 22, topPriority: "Quantify" },
  };
  const projection = buildScoreProjection({
    score,
    quickWins: report.quickWins as typeof QUICK_WINS,
    weakBulletCount: 2,
    keywordNames: ["Patient Safety", "Epic EHR", "Triage"],
  });
  applyScoreProjection(report, projection);
  report.projectedScore = projection.to > score ? projection.to : null;
  return { report, projection };
}

const renderReport = (extra: Record<string, unknown>) => render(
  <MemoryRouter>
    <FreeKeywordResults
      industry="healthcare"
      atsScoreEstimate={58}
      formatGrade="B"
      formatIssue="Clean single-column layout"
      resumeLength={"good" as never}
      redFlags={[]}
      keywords={[]}
      sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
      onGetFullAnalysis={vi.fn()}
      {...(extra as object)}
    />
  </MemoryRouter>,
);

function tickEverything(container: HTMLElement) {
  const heading = within(container).getByText("What happens if you fix it?");
  const card = heading.closest(".rounded-2xl") as HTMLElement;
  const boxes = within(card).getAllByRole("checkbox");
  for (const box of boxes) fireEvent.click(box);
  return { card, boxes };
}

describe("the simulator ticks through the scanner's one fix list", () => {
  it("with every box ticked it reads the projected score, not the quick wins' sum", () => {
    const { report, projection } = scannedReport(58);
    // The case this guards: the bullets and keywords steps are in the list,
    // so the quick wins alone fall short of the projection.
    expect(projection.fixes.map((f) => f.kind)).toEqual(["quick_win", "quick_win", "quick_win", "bullets", "keywords"]);
    const quickWinsOnly = 58 + projection.fixes.filter((f) => f.kind === "quick_win").reduce((s, f) => s + f.impact, 0);
    expect(quickWinsOnly).toBeLessThan(projection.to);

    const { container } = renderReport({
      quickWins: report.quickWins,
      improvementPotential: report.improvementPotential,
      projectedScore: report.projectedScore,
      scoreProjection: report.scoreProjection,
    });
    const { card, boxes } = tickEverything(container);
    expect(boxes).toHaveLength(projection.fixes.length);
    expect(card.textContent).toContain(`Projected: ${projection.to}`);
    expect(card.textContent).toContain(`(+${projection.gain} points)`);
    expect(card.textContent).not.toContain(`Projected: ${quickWinsOnly}`);
    // Improvement Potential is the same gain (applied by the engine).
    expect((report.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease).toBe(projection.gain);
  });

  it("an older response with no fix list keeps the quick wins, and a malformed list is ignored", () => {
    for (const scoreProjection of [undefined, null, { fixes: "x" }, { fixes: [{ label: "", impact: 4 }, { label: "No number", impact: "6" }] }]) {
      const { container, unmount } = renderReport({ quickWins: QUICK_WINS, scoreProjection });
      const { card, boxes } = tickEverything(container);
      expect(boxes, JSON.stringify(scoreProjection)).toHaveLength(QUICK_WINS.length);
      expect(card.textContent).toContain(`Projected: ${58 + 4 + 2 + 6}`);
      unmount();
    }
  });

  it("Index hands the scanner's list to the report under the name both scanners send", () => {
    expect(read("src/pages/Index.tsx")).toMatch(/scoreProjection=\{freeKeywordResult\.scoreProjection \?\? null\}/);
    expect(read("supabase/functions/free-keyword-scan/index.ts")).toMatch(/applyScoreProjection\(responseData, scoreProjection\)/);
    expect(read("supabase/functions/free-keyword-scan-stream/index.ts")).toMatch(/applyScoreProjection\(responseData, buildScoreProjection\(/);
  });
});

/**
 * Synthetic corpus (labelled: built here, not read from logs): every score
 * from 60 to 99 against fix lists the engine builds from quick-win sets of
 * one to five, with and without the bullets and keywords steps. Many of them
 * sum past the ceiling, which is the case the review found unguarded.
 */
const QW_SETS = [
  [{ fix: "Add your LinkedIn URL", impact: "medium" }],
  [{ fix: "Add your LinkedIn URL", impact: "high" }, { fix: "Move Skills up", impact: "low" }],
  [{ fix: "Name the ward size", scoreImpact: 9 }, { fix: "Add a summary", impact: "high" }, { fix: "Spell out ICU", impact: "medium" }],
  [{ fix: "A", impact: "high" }, { fix: "B", impact: "high" }, { fix: "C", impact: "high" }, { fix: "D", impact: "medium" }, { fix: "E", scoreImpact: 12 }],
];
const fixListsFor = (score: number) => QW_SETS.flatMap((quickWins) => [0, 2].flatMap((weak) => [[], ["Epic EHR", "Triage"]].map((keywordNames) =>
  buildScoreProjection({ score, quickWins, weakBulletCount: weak, keywordNames }))));
const lineOf = (container: HTMLElement) => container.querySelector("[data-simulator-projection]")?.textContent?.replace(/\s+/g, " ").trim() ?? "";

describe("the cap: a ticked box never adds a point past the ceiling", () => {
  it("the card reads the engine's ceiling, 95, and types no number of its own", () => {
    expect(PROJECTION_CEILING).toBe(95);
    const card = codeOf(read("src/components/ReportInsightCards.tsx"));
    expect(card).toMatch(/Math\.max\(atsScore, Math\.min\(PROJECTION_CEILING, atsScore \+ checkedSum\)\)/);
    expect(card).not.toMatch(/Math\.min\(95\b/);
  });

  it("with every box ticked, every score and list lands on the engine's projection, the cap binding or not", () => {
    let cases = 0, capBinds = 0, aboveCeiling = 0;
    for (let score = 60; score <= 99; score++) {
      for (const projection of fixListsFor(score)) {
        if (projection.fixes.length === 0) continue;
        cases++;
        const sum = projection.fixes.reduce((t, f) => t + f.impact, 0);
        if (score + sum > PROJECTION_CEILING) capBinds++;
        if (score >= PROJECTION_CEILING) aboveCeiling++;
        const { container, unmount } = render(<ScoreSimulatorCard atsScore={score} fixes={projection.fixes} />);
        for (const box of within(container).getAllByRole("checkbox")) fireEvent.click(box);
        const line = lineOf(container);
        const label = `score ${score}, sum ${sum}`;
        if (projection.gain > 0) {
          expect(line, label).toBe(`Projected: ${projection.to} (+${projection.gain} point${projection.gain === 1 ? "" : "s"})`);
          expect(projection.gain, label).toBeLessThanOrEqual(PROJECTION_CEILING - score);
        } else {
          expect(line, label).not.toMatch(/Projected:/);
          expect(line, label).toBe(score >= PROJECTION_CEILING
            ? en.freeResults.scoreSimulator.noGainCeiling.replace("{{ceiling}}", String(PROJECTION_CEILING))
            : en.freeResults.scoreSimulator.noGain);
        }
        unmount();
      }
    }
    // The corpus exercises the cap, and scores already at or past it.
    expect(cases).toBeGreaterThan(300);
    expect(capBinds).toBeGreaterThan(100);
    expect(aboveCeiling).toBeGreaterThan(50);
  });

  it("the reviewer's case: a 92 with +13 ticked reads 95 (+3), not (+13); a 98 reads no gain, not 95", () => {
    const { container } = render(<ScoreSimulatorCard atsScore={92} fixes={[{ label: "A", impact: 6 }, { label: "B", impact: 4 }, { label: "C", impact: 3 }]} />);
    for (const box of within(container).getAllByRole("checkbox")) fireEvent.click(box);
    expect(lineOf(container)).toBe("Projected: 95 (+3 points)");
    expect(container.textContent).not.toMatch(/105|\+13 points/);
    cleanup();
    const high = render(<ScoreSimulatorCard atsScore={98} fixes={[{ label: "A", impact: 6 }]} />);
    for (const box of within(high.container).getAllByRole("checkbox")) fireEvent.click(box);
    expect(lineOf(high.container)).toBe(en.freeResults.scoreSimulator.noGainCeiling.replace("{{ceiling}}", "95"));
    expect(high.container.textContent).not.toMatch(/Projected: 95|\+6 points/);
  });

  it("nothing ticked reads the current score line, never a projection", () => {
    const { container } = render(<ScoreSimulatorCard atsScore={70} fixes={[{ label: "A", impact: 6 }]} />);
    expect(lineOf(container)).toBe(en.freeResults.scoreSimulator.current);
  });
});

describe("the scanner's own fix steps are said in the reader's language (S13-122)", () => {
  const tOf = async (lng: string, bundle: object) => {
    const inst = i18next.createInstance();
    await inst.init({ lng, resources: { [lng]: { translation: bundle } }, interpolation: { escapeValue: false } });
    return inst.t;
  };
  const projection = buildScoreProjection({ score: 60, quickWins: [{ fix: "Kontaktzeile ergänzen", impact: "medium" }], weakBulletCount: 2, keywordNames: ["SQL", "Tableau"] });
  const unquantified = buildScoreProjection({ score: 60, quickWins: [], unquantifiedBulletCount: 1 });

  it("in English the codes say what the engine's labels say", async () => {
    const t = await tOf("en", en);
    for (const f of [...projection.fixes, ...unquantified.fixes]) expect(fixLabel(t, f), f.kind).toBe(f.label);
  });

  it("in German the coded steps are German, and the model's own quick win stays as sent", async () => {
    const t = await tOf("de", de);
    const [qw, bullets, keywords] = projection.fixes;
    expect(fixLabel(t, qw)).toBe("Kontaktzeile ergänzen");
    expect(fixLabel(t, bullets)).not.toBe(bullets.label);
    expect(fixLabel(t, bullets)).toContain("2");
    expect(fixLabel(t, keywords)).toContain('"SQL", "Tableau"');
    expect(fixLabel(t, keywords)).not.toBe(keywords.label);
    expect(fixLabel(t, unquantified.fixes[0])).not.toBe(unquantified.fixes[0].label);
  });

  it("a step whose params do not fit its code keeps the English label", async () => {
    const t = await tOf("de", de);
    for (const params of [undefined, {}, { count: 0 }, { count: 1.5 }, { keywords: [] }, { keywords: [3] }]) {
      expect(fixLabel(t, { label: "Sent label", code: "bulletsWeak", params })).toBe("Sent label");
      expect(fixLabel(t, { label: "Sent label", code: "keywords", params })).toBe("Sent label");
    }
    expect(fixLabel(t, { label: "Sent label", code: "notACode", params: { count: 2 } })).toBe("Sent label");
  });

  it("the simulator, the hero and the Fix Plan type no English of their own", () => {
    const card = codeOf(read("src/components/ReportInsightCards.tsx"));
    expect(card).toContain('t("freeResults.scoreSimulator.title")');
    expect(card).toContain("fixLabel(t, f)");
    expect(card).not.toMatch(/>\s*What happens if you fix it\?/);
    const hero = codeOf(read("src/components/scorecard/ScoreHero.tsx"));
    expect(hero).toContain('t("scoreHero.projection.lead")');
    expect(hero).toContain('t("scoreHero.projection.gain", { count: projectedScore - atsScoreEstimate })');
    expect(hero).not.toMatch(/Fix the issues below/);
    const page = codeOf(read("src/components/FreeKeywordResults.tsx"));
    expect(page).toMatch(/fixLabel\(t, \{ label: s\.step, code: s\.code, params: s\.params \}\)/);
  });

  it("every locale has the simulator, the fix labels and the hero line, with their placeholders", () => {
    const dir = resolve(ROOT, "src/i18n/locales");
    for (const loc of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const j = JSON.parse(readFileSync(resolve(dir, `${loc}.json`), "utf8"));
      const sim = j.freeResults.scoreSimulator, fl = j.freeResults.fixLabels, hero = j.scoreHero.projection;
      for (const k of ["title", "intro", "basis", "aria", "projectedLabel", "gain_one", "gain_other", "current", "noGainCeiling", "noGain"]) expect(sim[k], `${loc} scoreSimulator.${k}`).toBeTruthy();
      expect(sim.noGainCeiling, loc).toContain("{{ceiling}}");
      expect(sim.gain_other, loc).toContain("{{count}}");
      // A singular may say "your weakest bullet" with no figure; the plural must interpolate it.
      for (const k of ["bulletsWeak_one", "bulletsUnquantified_one"]) expect(fl[k], `${loc} fixLabels.${k}`).toBeTruthy();
      for (const k of ["bulletsWeak_other", "bulletsUnquantified_other"]) expect(fl[k], `${loc} fixLabels.${k}`).toContain("{{count}}");
      expect(fl.keywords, loc).toContain("{{keywords}}");
      expect(hero.lead, loc).toBeTruthy();
      expect(hero.gain_other, loc).toContain("{{count}}");
    }
  });
});
