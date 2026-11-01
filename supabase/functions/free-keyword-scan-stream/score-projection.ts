/**
 * ONE SCORE PROJECTION (register S13-058).
 *
 * The free report promised three scores for "fixing the issues below", each
 * worked out its own way: the hero's (the top three quick wins, plus 3 a weak
 * or unquantified bullet up to 9), the Fix Plan's (the quick wins, plus 5 for
 * bullets and 6 for keywords) and Improvement Potential's (the model's own
 * number). On one report they read 76, ~81 and +15, and the score simulator
 * with every box ticked read 70.
 *
 * Now there is one fix list with one impact per fix, and every figure is read
 * from it: the hero's projectedScore, the Fix Plan's steps and
 * finalProjectedScore, improvementPotential.estimatedScoreIncrease, and the
 * list itself (scoreProjection.fixes), which the simulator can tick through
 * to reach the same total. A quick win's impact is the one the simulator
 * already used (its scoreImpact, else high 6, medium 4, otherwise 2), and it is
 * written back on the quick win so the two cannot drift. A bullets or
 * keywords step is added only for work no quick win already names, so the
 * same work is not counted twice.
 *
 * This file is byte-identical in both scan forks, and a test compares them.
 */
import { resumeHasTerm } from './term-presence.ts';

/** No projection promises more than this. */
export const PROJECTION_CEILING = 95;
/** The bullets step and the keywords step: one impact each, wherever shown. */
export const BULLETS_FIX_IMPACT = 5;
export const KEYWORDS_FIX_IMPACT = 6;

export interface ProjectionFix {
  kind: 'quick_win' | 'bullets' | 'keywords';
  label: string;
  impact: number;
  minutes: number;
}

export interface ScoreProjection {
  from: number;
  to: number;
  gain: number;
  fixes: ProjectionFix[];
}

export interface FixPlan {
  steps: Array<{ order: number; step: string; minutes: number; scoreImpact: number; projectedScoreAfter: number }>;
  totalMinutes: number;
  finalProjectedScore: number;
}

type QuickWinLike = { fix?: unknown; timeEstimate?: unknown; scoreImpact?: unknown; impact?: unknown };

/** A quick win's points, by the rule the score simulator uses. */
export function quickWinImpact(w: QuickWinLike | null | undefined): number {
  const n = w?.scoreImpact;
  if (typeof n === 'number' && Number.isFinite(n)) return Math.max(0, Math.min(15, Math.round(n)));
  const level = typeof w?.impact === 'string' ? w.impact.trim().toLowerCase() : '';
  return level === 'high' ? 6 : level === 'medium' ? 4 : 2;
}

/** "10 min" is 10, "1 hour" is 30 (the cap); anything unreadable is the fallback. */
function minutesOf(timeEstimate: unknown, fallback: number): number {
  const text = typeof timeEstimate === 'string' ? timeEstimate : '';
  const m = text.match(/\d+/);
  let n = m ? parseInt(m[0], 10) : fallback;
  if (m && /\b(hours?|hrs?)\b/i.test(text)) n *= 60;
  return Math.min(Math.max(n, 1), 30);
}

export interface ProjectionInput {
  /** The report's final score. */
  score: number;
  /** The quick wins the report serves, in the order it serves them. */
  quickWins: QuickWinLike[];
  /** Weak bullets the rule-based check named (the weakest-bullets card). */
  weakBulletCount?: number;
  /** Bullets with no number, counted only when the résumé quantifies few. */
  unquantifiedBulletCount?: number;
  /** The report's missing keywords, most important first. */
  keywordNames?: string[];
}

export function buildScoreProjection(input: ProjectionInput): ScoreProjection {
  const from = Math.round(input.score);
  const fixes: ProjectionFix[] = [];
  for (const w of input.quickWins) {
    const label = typeof w?.fix === 'string' ? w.fix.trim() : '';
    if (!label) continue;
    fixes.push({ kind: 'quick_win', label, impact: quickWinImpact(w), minutes: minutesOf(w.timeEstimate, 10) });
  }
  const named = fixes.map((f) => f.label).join('\n');

  const weak = Math.min(Math.max(0, input.weakBulletCount ?? 0), 3);
  const unquantified = Math.min(Math.max(0, input.unquantifiedBulletCount ?? 0), 3);
  if ((weak > 0 || unquantified > 0) && !resumeHasTerm(named, 'bullet')) {
    const label = weak > 0
      ? `Rewrite your ${weak} weakest bullet${weak === 1 ? '' : 's'} using the before/after examples above`
      : `Add a result with a number to ${unquantified} bullet${unquantified === 1 ? '' : 's'} that ha${unquantified === 1 ? 's' : 've'} none`;
    fixes.push({ kind: 'bullets', label, impact: BULLETS_FIX_IMPACT, minutes: 15 });
  }

  const keywords = (input.keywordNames ?? [])
    .filter((k) => typeof k === 'string' && k.trim() !== '' && !resumeHasTerm(named, k))
    .slice(0, 3);
  if (keywords.length > 0) {
    fixes.push({ kind: 'keywords', label: `Work "${keywords.join('", "')}" into your summary and experience bullets`, impact: KEYWORDS_FIX_IMPACT, minutes: 10 });
  }

  const sum = fixes.reduce((s, f) => s + f.impact, 0);
  const to = Math.max(from, Math.min(PROJECTION_CEILING, from + sum));
  return { from, to, gain: to - from, fixes };
}

/**
 * The Fix Plan: the same fixes, ordered by points per minute, with the score
 * after each. Its last step lands on the projection's `to`, never below the
 * score it started from.
 */
export function fixPlanOf(p: ScoreProjection): FixPlan {
  const ordered = [...p.fixes].sort((a, b) => (b.impact / b.minutes) - (a.impact / a.minutes));
  let cumulative = p.from;
  const steps = ordered.map((f, i) => {
    cumulative = Math.max(p.from, Math.min(PROJECTION_CEILING, cumulative + f.impact));
    return { order: i + 1, step: f.label, minutes: f.minutes, scoreImpact: f.impact, projectedScoreAfter: cumulative };
  });
  return { steps, totalMinutes: steps.reduce((s, x) => s + x.minutes, 0), finalProjectedScore: p.to };
}

/**
 * Writes the projection onto a report: each served quick win's scoreImpact,
 * improvementPotential.estimatedScoreIncrease, and scoreProjection. The
 * model's level and topPriority stay; only the number is the projection's.
 */
export function applyScoreProjection(report: Record<string, unknown>, p: ScoreProjection): void {
  if (Array.isArray(report.quickWins)) {
    report.quickWins = (report.quickWins as QuickWinLike[]).map((w) =>
      w && typeof w === 'object' ? { ...w, scoreImpact: quickWinImpact(w) } : w);
  }
  const ip = report.improvementPotential;
  if (typeof ip === 'number') report.improvementPotential = p.gain;
  else if (ip && typeof ip === 'object') (ip as { estimatedScoreIncrease?: number }).estimatedScoreIncrease = p.gain;
  report.scoreProjection = p;
}
