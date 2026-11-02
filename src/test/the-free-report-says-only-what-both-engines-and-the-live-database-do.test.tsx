/**
 * THE FREE REPORT SAYS ONLY WHAT BOTH ENGINES AND THE LIVE DATABASE DO
 * (the free-scan wave's landing check, 2026-11-01).
 *
 * Merging the wave publishes the page at once; the scanner and the
 * migrations change later, when a deploy message is pasted. So for a while
 * the new page reads the old engine's answers against a database without
 * 20261101110000, and each sentence below has to be true of both.
 *
 *   F1  The Score Potential card said its number was the simulator's and the
 *       Fix Plan's fixes, keyword step included. That is the new engine's
 *       scoreProjection. The old engine's projectedScore is its own sum (the
 *       top three quick wins, up to three bullets at 3 points each, capped
 *       at 95, no keyword step), and the old simulator ticks quick wins only.
 *       The card now names the basis of the number it has.
 *   F2  The note by the Industry and Level selects promised every correction
 *       "is logged". The live database refuses log_seniority_correction
 *       (42501) until 20261101110000, and the page swallowed the refusal.
 *       The note now promises only the report update, and the page reads the
 *       RPC's answer: only a plain true says the correction was recorded.
 *   F3  The findings index counted rewrites by the builder's rule, which
 *       refuses any [bracket], while the card shows every non-empty rewrite,
 *       brackets included, and both prompts ask for brackets. The index now
 *       counts what the card shows; the hand-off still applies none with a
 *       bracket.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import en from "@/i18n/locales/en.json";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";

vi.setConfig(MOUNT_TEST_BUDGET);

type RpcAnswer = { data: unknown; error: unknown };
const { rpc, seniority } = vi.hoisted(() => {
  const seniority: { answer: () => Promise<{ data: unknown; error: unknown }> } = {
    answer: async () => ({ data: true, error: null }),
  };
  const rpc = vi.fn(async (name: string, _args?: unknown) =>
    name === "log_seniority_correction" ? seniority.answer() : { data: null, error: null });
  return { rpc, seniority };
});

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
      rpc,
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
import { isUsableRewrite } from "@/lib/builder-import";

afterEach(() => { cleanup(); rpc.mockClear(); sessionStorage.clear(); });

const LOCALES = resolve(__dirname, "../../src/i18n/locales");
/** Every locale file, by file name. */
const readLocales = (): Record<string, typeof en> => Object.fromEntries(
  readdirSync(LOCALES).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(readFileSync(resolve(LOCALES, f), "utf8"))]),
);

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

const QUICK_WINS = [
  { fix: "Add your LinkedIn URL to the contact line", timeEstimate: "2 min", impact: "medium" as const, scoreImpact: 5 },
  { fix: "Move Skills above Education", timeEstimate: "5 min", impact: "low" as const },
  { fix: "Name the ward size in your current role", timeEstimate: "10 min", impact: "high" as const, scoreImpact: 7 },
];

/**
 * The old engine's projectedScore, as origin/main's free-keyword-scan
 * computes it today: the top three quick wins (scoreImpact, or 4 when
 * missing) plus min(weak + unquantified bullets, 3) x 3, capped at 95. It
 * sends no scoreProjection.
 */
const oldEngineProjection = (score: number, quickWins: Array<{ scoreImpact?: number }>, bullets: number) =>
  Math.min(95, Math.round(score + quickWins.slice(0, 3).reduce((s, w) => s + (w.scoreImpact ?? 4), 0) + Math.min(bullets, 3) * 3));

const basisOf = (container: HTMLElement) => container.querySelector("[data-score-potential-basis]")?.textContent ?? null;

describe("F1: the Score Potential card names the basis its number has", () => {
  it("an old-engine response (projectedScore, no scoreProjection) makes no claim about the simulator, the Fix Plan or a keyword step", () => {
    const projected = oldEngineProjection(58, QUICK_WINS, 2);
    expect(projected).toBe(58 + 5 + 4 + 7 + 6);
    const { container } = renderReport({ quickWins: QUICK_WINS, projectedScore: projected });
    const basis = basisOf(container);
    expect(basis, "the card did not render for an old-engine projection").not.toBeNull();
    expect(basis).toContain(en.freeResults.scorePotential.basisQuickWins);
    expect(basis).not.toContain(en.freeResults.scorePotential.basis);
    expect(basis).not.toMatch(/simulator/i);
    expect(basis).not.toMatch(/fix plan/i);
    expect(basis).not.toMatch(/keyword/i);
    // The sum it does name is the old engine's: quick wins, bullets, the cap.
    expect(en.freeResults.scorePotential.basisQuickWins).toMatch(/quick wins/);
    expect(en.freeResults.scorePotential.basisQuickWins).toMatch(/bullet/);
    expect(en.freeResults.scorePotential.basisQuickWins).toMatch(/95/);
  });

  it("a list that is present but unusable is not the list the simulator ticks, so the card says the older sum", () => {
    for (const scoreProjection of [null, { fixes: [] }, { fixes: "x" }, { fixes: [{ label: "", impact: 4 }, { label: "No number", impact: "6" }] }]) {
      const { container, unmount } = renderReport({ quickWins: QUICK_WINS, projectedScore: 80, scoreProjection });
      const basis = basisOf(container) ?? "";
      expect(basis, JSON.stringify(scoreProjection)).toContain(en.freeResults.scorePotential.basisQuickWins);
      expect(basis, JSON.stringify(scoreProjection)).not.toMatch(/simulator|fix plan|keyword/i);
      unmount();
    }
  });

  it("a new-engine response keeps the simulator and Fix Plan basis", () => {
    const report: Record<string, unknown> = { atsScoreEstimate: 58, quickWins: QUICK_WINS.map((w) => ({ ...w })) };
    const projection = buildScoreProjection({ score: 58, quickWins: QUICK_WINS, weakBulletCount: 2, keywordNames: ["Triage", "Epic EHR"] });
    applyScoreProjection(report, projection);
    const { container } = renderReport({ quickWins: report.quickWins, projectedScore: projection.to, scoreProjection: report.scoreProjection });
    const basis = basisOf(container) ?? "";
    expect(basis).toContain(en.freeResults.scorePotential.basis);
    expect(basis).not.toContain(en.freeResults.scorePotential.basisQuickWins);
  });

  it("every locale says the older sum in its own words, with the cap", () => {
    const locales = readLocales();
    const files = Object.keys(locales);
    expect(files).toHaveLength(9);
    for (const file of files) {
      const s = locales[file].freeResults.scorePotential;
      expect(typeof s.basisQuickWins === "string" && s.basisQuickWins.length > 20, file).toBe(true);
      expect(s.basisQuickWins, file).toContain("95");
      expect(s.basisQuickWins, file).not.toBe(s.basis);
      if (!file.startsWith("en")) expect(s.basisQuickWins, `${file} is the English sentence`).not.toBe(en.freeResults.scorePotential.basisQuickWins);
    }
  });
});

describe("F2: a correction is called recorded only when the database said so", () => {
  const pickLevel = async (container: HTMLElement, level: string) => {
    const select = container.querySelector("select[data-level-select]") as HTMLSelectElement;
    expect(select, "the level select did not render").not.toBeNull();
    await act(async () => { fireEvent.change(select, { target: { value: level } }); });
  };
  const seniorityCalls = () => rpc.mock.calls.filter(([name]) => name === "log_seniority_correction");

  it("the note beside the selects promises the report update, and no logging", () => {
    const { container } = renderReport({ experienceLevel: { level: "mid", yearsEstimate: "~6 years" } });
    const note = container.querySelector("[data-read-as-note]")?.textContent ?? "";
    expect(note).toBe(en.freeResults.readAs.note);
    expect(note).not.toMatch(/log|record|improve/i);
    expect(container.querySelector("[data-level-correction-logged]")).toBeNull();
  });

  const unrecorded: Array<[string, () => Promise<RpcAnswer>]> = [
    ["refused with 42501 (the live database before 20261101110000)", async () => ({ data: null, error: { code: "42501", message: "permission denied for function log_seniority_correction" } })],
    ["answered false (an invalid pair, or the budget spent)", async () => ({ data: false, error: null })],
    ["answered null with no error", async () => ({ data: null, error: null })],
    ["answered a truthy non-boolean", async () => ({ data: "true", error: null })],
    ["threw (the network failed)", async () => { throw new Error("Failed to fetch"); }],
  ];
  for (const [what, answer] of unrecorded) {
    it(`a correction the database ${what} says nothing about being logged`, async () => {
      seniority.answer = answer;
      const { container } = renderReport({ experienceLevel: { level: "mid", yearsEstimate: "~6 years" } });
      await pickLevel(container, "senior");
      await waitFor(() => expect(seniorityCalls()).toHaveLength(1), SLOW);
      await act(async () => { await Promise.resolve(); });
      expect(seniorityCalls()[0][1]).toEqual(expect.objectContaining({ p_detected_level: "mid", p_corrected_level: "senior" }));
      expect(container.querySelector("[data-level-correction-logged]")).toBeNull();
      expect(container.textContent).not.toContain(en.freeResults.readAs.levelLogged);
      // The report still takes the correction: the select holds it.
      expect((container.querySelector("select[data-level-select]") as HTMLSelectElement).value).toBe("senior");
    });
  }

  it("a plain true says it was logged, and the next pick clears it until its own answer", async () => {
    seniority.answer = async () => ({ data: true, error: null });
    const { container } = renderReport({ experienceLevel: { level: "mid", yearsEstimate: "~6 years" } });
    await pickLevel(container, "senior");
    await waitFor(() => expect(container.querySelector("[data-level-correction-logged]")?.textContent).toBe(en.freeResults.readAs.levelLogged), SLOW);

    seniority.answer = async () => ({ data: false, error: null });
    await pickLevel(container, "executive");
    await waitFor(() => expect(seniorityCalls()).toHaveLength(2), SLOW);
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector("[data-level-correction-logged]")).toBeNull();

    // Back to the level detected is no correction: nothing is sent or claimed.
    seniority.answer = async () => ({ data: true, error: null });
    await pickLevel(container, "mid");
    await act(async () => { await Promise.resolve(); });
    expect(seniorityCalls()).toHaveLength(2);
    expect(container.querySelector("[data-level-correction-logged]")).toBeNull();
  });

  it("an earlier pick's late true does not speak for a later pick the database refused", async () => {
    let releaseFirst: (v: RpcAnswer) => void = () => {};
    seniority.answer = () => new Promise<RpcAnswer>((r) => { releaseFirst = r; });
    const { container } = renderReport({ experienceLevel: { level: "mid", yearsEstimate: "~6 years" } });
    await pickLevel(container, "senior");
    seniority.answer = async () => ({ data: null, error: { code: "42501" } });
    await pickLevel(container, "executive");
    await waitFor(() => expect(seniorityCalls()).toHaveLength(2), SLOW);
    await act(async () => { releaseFirst({ data: true, error: null }); await Promise.resolve(); });
    expect(container.querySelector("[data-level-correction-logged]")).toBeNull();
  });

  it("every locale's note makes no logging promise, and every locale can say a recorded correction in its own words", () => {
    const locales = readLocales();
    // The withdrawn promise, as each locale said it.
    const withdrawn: Record<string, RegExp> = {
      "en.json": /logged/, "en-GB.json": /logged/, "de.json": /protokolliert/, "es.json": /registrada/,
      "fr.json": /enregistrée/, "hi.json": /दर्ज/, "nl.json": /vastgelegd/, "pt.json": /registrada/, "tl.json": /itinatala/,
    };
    expect(Object.keys(locales)).toHaveLength(9);
    for (const [file, d] of Object.entries(locales)) {
      expect(withdrawn[file], `no withdrawn phrase listed for ${file}`).toBeDefined();
      expect(d.freeResults.readAs.note, file).not.toMatch(withdrawn[file]);
      expect(typeof d.freeResults.readAs.levelLogged === "string" && d.freeResults.readAs.levelLogged.length > 20, file).toBe(true);
      if (!file.startsWith("en")) {
        expect(d.freeResults.readAs.note, `${file} note is the English sentence`).not.toBe(en.freeResults.readAs.note);
        expect(d.freeResults.readAs.levelLogged, `${file} levelLogged is the English sentence`).not.toBe(en.freeResults.readAs.levelLogged);
      }
    }
  });
});

describe("F3: the findings index counts the rewrites the card shows; the hand-off applies none with a bracket", () => {
  const RESUME = "Registered Nurse with eight years in acute care. Responsible for patients on a busy ward. Helped with charts and handover notes every shift.";
  const BULLETS = [
    { original: "Responsible for patients on a busy ward", grade: "D", issues: [], rewrite: "Cared for [N] patients a shift on a [X]-bed acute ward" },
    { original: "Helped with charts and handover notes every shift", grade: "F", issues: [], rewrite: "Audited 40 charts a week and cut handover errors by a third" },
  ];

  it("two rewrites shown, one with brackets: the index says both are provided, the hand-off offers one", () => {
    expect(BULLETS.map((b) => isUsableRewrite(b.rewrite))).toEqual([false, true]);
    const { container } = renderReport({ resumeText: RESUME, weakestBullets: BULLETS });
    const shown = [...container.querySelectorAll("[data-bullet-rewrite]")].map((n) => n.textContent);
    expect(shown).toEqual(BULLETS.map((b) => b.rewrite));
    const items = en.reportInsights.findings.items;
    expect(container.textContent).toContain(items.weakBulletsAll_other.replace("{{count}}", "2"));
    expect(container.textContent).not.toContain(items.weakBulletsSome_other.replace("{{count}}", "2").replace("{{rewritten}}", "1"));

    const handoff = container.querySelector("[data-builder-handoff]") as HTMLElement;
    expect(handoff, "the hand-off did not render").not.toBeNull();
    expect(handoff.textContent).toContain(en.freeResults.builderHandoff.ctaRewrites_one.replace("{{count}}", "1"));
    const link = handoff.querySelector("a") as HTMLAnchorElement;
    fireEvent.click(link);
    const payload = JSON.parse(sessionStorage.getItem("rb_scan_fixes") ?? "{}") as { rewrites?: Array<{ before: string; after: string }> };
    expect(payload.rewrites).toEqual([{ before: BULLETS[1].original, after: BULLETS[1].rewrite }]);
  });

  it("a null or blank rewrite is neither shown nor counted", () => {
    const { container } = renderReport({
      resumeText: RESUME,
      weakestBullets: [BULLETS[0], { ...BULLETS[1], rewrite: "   " }, { original: "Did tasks", grade: "F", issues: [], rewrite: null }],
    });
    expect(container.querySelectorAll("[data-bullet-rewrite]")).toHaveLength(1);
    expect(container.textContent).toContain(
      en.reportInsights.findings.items.weakBulletsSome_other.replace("{{count}}", "3").replace("{{rewritten}}", "1"),
    );
    // The one shown has brackets, so the builder is offered none.
    expect(container.querySelector("[data-builder-handoff]")?.textContent).toContain(en.freeResults.builderHandoff.ctaNoRewrites);
  });
});
