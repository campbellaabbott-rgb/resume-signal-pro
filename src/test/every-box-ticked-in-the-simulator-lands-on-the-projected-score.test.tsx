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
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
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
import { applyScoreProjection, buildScoreProjection } from "../../supabase/functions/free-keyword-scan/score-projection";

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
