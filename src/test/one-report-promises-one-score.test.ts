/**
 * ONE REPORT PROMISES ONE SCORE (register S13-058).
 *
 * The free report gave three scores for "fixing the issues below": the hero's
 * (quick wins plus 3 a weak bullet), the Fix Plan's (quick wins plus 5 for
 * bullets and 6 for keywords) and Improvement Potential's (the model's own).
 * On the register's report (58; quick wins 5/4/3; two weak bullets) they read
 * 76, ~81 and +15. Now one fix list with one impact per fix (score-projection.ts,
 * byte-identical in both forks) gives all of them, and the list itself rides
 * on the response as scoreProjection.fixes for the simulator.
 *
 * Corpus (~/.config/resumebooster/free-scan-wave-corpora/S13-058, SYNTHETIC
 * report shapes; arithmetic, not a heuristic): 400 cases. The three figures
 * agreed on main in 5, on the branch in 400. A simulator fed the fix list
 * agrees with them in 400; fed the quick wins alone, as the page does today,
 * in 144.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyScoreProjection, buildScoreProjection, fixPlanOf, improvementLevelOf, quickWinImpact, PROJECTION_CEILING,
} from "../../supabase/functions/free-keyword-scan/score-projection";
import slice from "./fixtures/free-scan-wave/s13-058-score-projection.json";

const QW = (fix: string, scoreImpact: number, timeEstimate = "10 min") => ({ fix, scoreImpact, timeEstimate, impact: "high" });

describe("the register's report", () => {
  const quickWins = [QW("Add the revenue number from your Acme role", 5), QW("Move Skills above Education", 4, "5 min"), QW("Add a LinkedIn URL", 3, "2 min")];
  const p = buildScoreProjection({ score: 58, quickWins, weakBulletCount: 2, keywordNames: ["SQL", "Tableau", "Python"] });
  const report: Record<string, unknown> = { atsScoreEstimate: 58, quickWins, improvementPotential: { level: "high", estimatedScoreIncrease: 15, topPriority: "Metrics" } };
  applyScoreProjection(report, p);
  const plan = fixPlanOf(p);

  it("the hero, the Fix Plan and Improvement Potential give one number", () => {
    expect(p.to).toBe(58 + 5 + 4 + 3 + 5 + 6);
    expect(plan.finalProjectedScore).toBe(p.to);
    expect(plan.steps[plan.steps.length - 1].projectedScoreAfter).toBe(p.to);
    expect((report.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease).toBe(p.to - 58);
  });
  it("ticking every fix in the list reaches it", () => {
    expect(58 + p.fixes.reduce((s, f) => s + f.impact, 0)).toBe(p.to);
    expect(report.scoreProjection).toEqual(p);
  });
  it("the model's priority stays; the number and its level are the projection's", () => {
    expect(report.improvementPotential).toMatchObject({ level: improvementLevelOf(p.gain), topPriority: "Metrics" });
  });
  // Recheck (2026-11-01): the model's level stayed beside the projection's
  // number, so a report could read "+10 pts" over "Already optimized".
  it("a level the model gave that the gain contradicts is replaced", () => {
    for (const [score, modelLevel, want] of [[60, "low", "high"], [94, "high", "low"], [97, "high", "low"]] as const) {
      const r: Record<string, unknown> = { atsScoreEstimate: score, quickWins, improvementPotential: { level: modelLevel, estimatedScoreIncrease: 15 } };
      const q = buildScoreProjection({ score, quickWins, weakBulletCount: 2, keywordNames: ["SQL"] });
      applyScoreProjection(r, q);
      expect((r.improvementPotential as { level: string }).level, `${score}`).toBe(want);
      expect((r.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease).toBe(q.gain);
    }
    expect([0, 4, 5, 9, 10, 25].map(improvementLevelOf)).toEqual(["low", "low", "medium", "medium", "high", "high"]);
  });
});

describe("one fix is counted once", () => {
  it("no bullets step when a quick win already names the bullets", () => {
    const p = buildScoreProjection({ score: 50, quickWins: [QW("Rewrite bullets that start with passive phrases", 5)], weakBulletCount: 3 });
    expect(p.fixes.map((f) => f.kind)).toEqual(["quick_win"]);
  });
  it("the keywords step names only keywords no quick win names", () => {
    const p = buildScoreProjection({ score: 50, quickWins: [QW("Name SQL in your summary", 3)], keywordNames: ["SQL", "Tableau"] });
    expect(p.fixes.find((f) => f.kind === "keywords")!.label).toBe('Work "Tableau" into your summary and experience bullets');
    const none = buildScoreProjection({ score: 50, quickWins: [QW("Name SQL in your summary", 3)], keywordNames: ["SQL"] });
    expect(none.fixes.some((f) => f.kind === "keywords")).toBe(false);
  });
  it("a short keyword is a word, not a letter of another one", () => {
    const p = buildScoreProjection({ score: 50, quickWins: [QW("Add your R&D budget", 3)], keywordNames: ["R"] });
    expect(p.fixes.some((f) => f.kind === "keywords")).toBe(true);
  });
  it("unquantified bullets make the bullets step when there are no weak ones", () => {
    const p = buildScoreProjection({ score: 50, quickWins: [], unquantifiedBulletCount: 4 });
    expect(p.fixes).toEqual([{ kind: "bullets", code: "bulletsUnquantified", params: { count: 3 }, label: "Add a result with a number to 3 bullets that have none", impact: 5, minutes: 15 }]);
  });
});

describe("bounds", () => {
  it("no projection passes the ceiling, and none falls below the score", () => {
    expect(buildScoreProjection({ score: 90, quickWins: [QW("a", 15), QW("b", 15)] }).to).toBe(PROJECTION_CEILING);
    const high = buildScoreProjection({ score: 97, quickWins: [QW("a", 5)] });
    expect(high).toMatchObject({ from: 97, to: 97, gain: 0 });
    expect(fixPlanOf(high).steps[0].projectedScoreAfter).toBe(97);
  });
  it("nothing to fix promises nothing", () => {
    const p = buildScoreProjection({ score: 70, quickWins: [] });
    expect(p).toEqual({ from: 70, to: 70, gain: 0, fixes: [] });
  });
  it("a quick win's points follow the simulator's rule, and are written back on it", () => {
    expect(quickWinImpact({ scoreImpact: 7 })).toBe(7);
    expect(quickWinImpact({ scoreImpact: 40 })).toBe(15);
    expect(quickWinImpact({ impact: "High" })).toBe(6);
    expect(quickWinImpact({ impact: "medium" })).toBe(4);
    expect(quickWinImpact({ impact: "alta" })).toBe(2);
    const report: Record<string, unknown> = { quickWins: [{ fix: "x", impact: "medium" }] };
    applyScoreProjection(report, buildScoreProjection({ score: 60, quickWins: report.quickWins as [] }));
    expect((report.quickWins as Array<{ scoreImpact: number }>)[0].scoreImpact).toBe(4);
  });
  it("an hour is the 30-minute cap, not one minute", () => {
    expect(buildScoreProjection({ score: 60, quickWins: [QW("x", 3, "1 hour")] }).fixes[0].minutes).toBe(30);
  });
});

describe("the corpus slice", () => {
  type Case = { id: string; score: number; quickWins: Array<{ fix: string; scoreImpact: number; timeEstimate: string; impact: string }>; weak: number; quantRate: number; unq: number; keywords: string[]; modelInc: number; main: { hero: number; plan: number; ip: number; agree: boolean } };
  const cases = (slice as { cases: Case[] }).cases;
  it("holds 60 synthetic report shapes, most of which main showed three numbers for", () => {
    expect(cases.length).toBe(60);
    expect(cases.filter((c) => !c.main.agree).length).toBeGreaterThanOrEqual(30);
  });
  for (const c of cases) {
    it(`${c.id}: one number`, () => {
      const p = buildScoreProjection({ score: c.score, quickWins: c.quickWins.slice(0, 3), weakBulletCount: c.weak, unquantifiedBulletCount: c.quantRate < 40 ? c.unq : 0, keywordNames: c.keywords });
      const report: Record<string, unknown> = { atsScoreEstimate: c.score, quickWins: c.quickWins.slice(0, 3), improvementPotential: { estimatedScoreIncrease: c.modelInc } };
      applyScoreProjection(report, p);
      const ip = c.score + (report.improvementPotential as { estimatedScoreIncrease: number }).estimatedScoreIncrease;
      expect(fixPlanOf(p).finalProjectedScore).toBe(p.to);
      expect(ip).toBe(p.to);
      expect(Math.max(c.score, Math.min(PROJECTION_CEILING, c.score + p.fixes.reduce((s, f) => s + f.impact, 0)))).toBe(p.to);
    });
  }
});

describe("both scanners", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  it("score-projection.ts is the same file in both forks, byte for byte", () => {
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/score-projection.ts"), "utf8"))
      .toBe(readFileSync(resolve(root, "free-keyword-scan/score-projection.ts"), "utf8"));
  });
  it("the primary keeps no projection arithmetic of its own", () => {
    const src = readFileSync(resolve(root, "free-keyword-scan/index.ts"), "utf8");
    expect(src).not.toMatch(/weakBulletImpact|qwScoreImpact|cumulative = Math\.min\(95/);
    expect(src).toContain("const fixRoadmap = fixPlanOf(scoreProjection);");
    expect(src).toContain("applyScoreProjection(responseData, scoreProjection);");
  });
  it("the fallback applies the same projection", () => {
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/index.ts"), "utf8")).toContain("applyScoreProjection(responseData, buildScoreProjection({");
  });
});
