/**
 * THE BENCH IN ONE PLACE: what the CI gate (src/test/match-bench-gate.test.ts)
 * and the report (scripts/match-bench/report.ts) both measure, the recorded
 * baselines they compare with, and the gate's rule with its stated tolerance.
 *
 * Nothing here touches the network. BEFORE is replayed from its frozen
 * measurement (before/ranked.json); AFTER runs the engine's own code against
 * the frozen corpus (after-pipeline.ts); the profile reader is scored on the
 * held-out set's parsed text (reader-score.ts).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES } from "./corpus.ts";
import { engineState, ENGINE_FILES, parsedText, REPO_ROOT, runAfter, type AfterResume, type Mode } from "./after-pipeline.ts";
import { HELDOUT } from "./heldout/manifest.ts";
import { judgeShown, replayBefore, type SetSummary } from "./metrics.ts";
import { scoreReader, type ReaderAnswer, type ReaderScore } from "./reader-score.ts";

// ─── The gate's rule ───────────────────────────────────────────────────────
/**
 * STATED TOLERANCES. P@10 on the exact 11 is a mean of 11 ten-slot precisions,
 * so one row moving in one résumé moves it by 0.9 points: 5 points is about
 * six rows across the set, more than a re-ordering and less than a real loss.
 * Location mismatch in the shown top 20 is pooled over about 190 rows: 2 points
 * is about four more rows the candidate cannot take.
 */
export const GATE_TOLERANCE = {
  /** exact-11 P@10 may fall at most this many points below the recorded AFTER baseline. */
  p10Points: 5,
  /** location mismatch in the top 20 (exact 11, and all 24) may rise at most this many points above it. */
  locationPoints: 2,
  /** held-out profile reader: country, city, years and entry recall may fall at most this many points. */
  readerPoints: 5,
} as const;

export interface AfterMeasure {
  mode: Mode;
  exact11: SetSummary;
  all24: SetSummary;
  /** Résumés whose page showed no row. */
  zero: string[];
  perResume: Record<string, { rows: number; shortlisted: number; family: string | null; steps: number[] }>;
  maxWallMs: number;
}

export interface AfterBaseline {
  recordedAt: string;
  engine: { ref: string; note: string };
  corpusVersion: string;
  rubric: "v2";
  tolerance: typeof GATE_TOLERANCE;
  extract: AfterMeasure;
  oracle: AfterMeasure | null;
  reader: Omit<ReaderScore, "misses"> | null;
}

export interface BeforeBaseline {
  recordedAt: string;
  note: string;
  legacy: { exact11: SetSummary; all24: ReturnType<typeof replayBefore>["all24"] };
  v2: { exact11: SetSummary; all24: ReturnType<typeof replayBefore>["all24"] };
  proto: Record<"extract" | "oracle", { legacy: { exact11: SetSummary; all24: SetSummary }; v2: { exact11: SetSummary; all24: SetSummary } }>;
}

const BASELINES = join(FIXTURES, "baselines");
export const BEFORE_BASELINE_FILE = join(BASELINES, "before.json");
export const AFTER_BASELINE_FILE = join(BASELINES, "v1.json");

export function loadBeforeBaseline(): BeforeBaseline {
  return JSON.parse(readFileSync(BEFORE_BASELINE_FILE, "utf8")) as BeforeBaseline;
}
export function loadAfterBaseline(): AfterBaseline | null {
  return existsSync(AFTER_BASELINE_FILE) ? (JSON.parse(readFileSync(AFTER_BASELINE_FILE, "utf8")) as AfterBaseline) : null;
}

// ─── Whether the engine is here ────────────────────────────────────────────
export type EngineReadiness =
  | { kind: "absent"; message: string }
  | { kind: "partial"; message: string; missing: string[] }
  | { kind: "ready"; migration: string };

/**
 * ABSENT (none of spec §18's modules and no match_candidates migration) is the
 * only state the gate skips in. A branch carrying SOME of them is a half-merged
 * engine: that fails, naming what is missing, instead of skipping quietly.
 */
export function engineReadiness(root = REPO_ROOT): EngineReadiness {
  const s = engineState(root);
  if (s.present.length === 0 && !s.migration) {
    return { kind: "absent", message: `the résumé matcher is not on this branch yet: none of ${ENGINE_FILES.join(", ")} exists and no migration creates public.match_candidates` };
  }
  const missing = [...s.missing, ...(s.migration ? [] : ["a supabase/migrations file creating public.match_candidates"])];
  if (missing.length) return { kind: "partial", missing, message: `the résumé matcher is half here: missing ${missing.join(", ")}` };
  return { kind: "ready", migration: s.migration! };
}

// ─── Measuring ─────────────────────────────────────────────────────────────
export function summarizeAfter(mode: Mode, per: AfterResume[]): AfterMeasure {
  const shown = Object.fromEntries(per.map((p) => [p.id, p.rows]));
  const j = judgeShown(shown, "v2");
  const perResume = Object.fromEntries(per.map((p) => {
    const l = j.lists.find((x) => x.id === p.id)!;
    return [p.id, { rows: p.rows.length, shortlisted: l.verdicts.filter((v) => v.shortlist).length, family: p.family, steps: p.steps }];
  }));
  return {
    mode,
    exact11: j.exact11,
    all24: j.all24,
    zero: per.filter((p) => p.rows.length === 0).map((p) => p.id).sort(),
    perResume,
    maxWallMs: Math.max(0, ...per.map((p) => p.wallMs)),
  };
}

export async function measureAfter(mode: Mode = "extract", root = REPO_ROOT): Promise<{ measure: AfterMeasure; per: AfterResume[]; corpusVersion: string; migration: string }> {
  const r = await runAfter({ root, mode });
  return { measure: summarizeAfter(mode, r.per), per: r.per, corpusVersion: r.corpusVersion, migration: r.migration };
}

/** The engine's profile reader over the 60 held-out résumés' parsed PDF text. */
export async function measureReader(root = REPO_ROOT, nowYear = 2026): Promise<ReaderScore> {
  const { pathToFileURL } = await import("node:url");
  const mod = await import(/* @vite-ignore */ pathToFileURL(join(root, "supabase/functions/_shared/resume-profile.ts")).href);
  return scoreReader(HELDOUT.map((t) => ({ truth: t, answer: mod.readProfile(parsedText(t.id, "heldout"), { nowYear }) as ReaderAnswer })));
}

export const withoutMisses = (s: ReaderScore): Omit<ReaderScore, "misses"> => {
  const { misses: _m, ...rest } = s;
  return rest;
};

// ─── The verdict ───────────────────────────────────────────────────────────
/**
 * Every way the current AFTER run falls short of the recorded baseline (beyond
 * the stated tolerance) or of BEFORE (judged with the same v2 rubric on the
 * same résumés). Empty means the gate passes.
 */
export function gateFailures(current: AfterMeasure, baseline: AfterBaseline, before: BeforeBaseline, tol = GATE_TOLERANCE): string[] {
  const out: string[] = [];
  const b = baseline.extract;
  const p10 = current.exact11.p10 ?? 0;
  const p10Floor = (b.exact11.p10 ?? 0) - tol.p10Points;
  if (p10 < p10Floor) out.push(`exact-11 P@10 ${p10}% is below the recorded ${b.exact11.p10}% minus ${tol.p10Points} points (${p10Floor}%)`);
  const loc = (cur: number | null, rec: number | null, set: string) => {
    const ceiling = (rec ?? 0) + tol.locationPoints;
    if ((cur ?? 0) > ceiling) out.push(`${set} top-20 location mismatch ${cur}% is above the recorded ${rec}% plus ${tol.locationPoints} points (${ceiling}%)`);
  };
  loc(current.exact11.location, b.exact11.location, "exact-11");
  loc(current.all24.location, b.all24.location, "all-24");
  const newlyZero = current.zero.filter((id) => !b.zero.includes(id));
  if (newlyZero.length) out.push(`résumés newly at zero rows: ${newlyZero.join(", ")}`);
  // Like with like: AFTER must still beat BEFORE on the same 11 résumés under the same rubric.
  if (p10 <= (before.v2.exact11.p10 ?? 0)) out.push(`exact-11 P@10 ${p10}% no longer beats BEFORE's ${before.v2.exact11.p10}% (v2 rubric)`);
  if ((current.exact11.location ?? 100) >= (before.v2.exact11.location ?? 0)) out.push(`exact-11 location mismatch ${current.exact11.location}% no longer beats BEFORE's ${before.v2.exact11.location}%`);
  return out;
}

/** Held-out reader regressions beyond the tolerance. Authorisation precision may never fall. */
export function readerFailures(current: Omit<ReaderScore, "misses">, recorded: Omit<ReaderScore, "misses">, tol = GATE_TOLERANCE): string[] {
  const out: string[] = [];
  for (const k of ["country", "city", "years3", "entryRecall"] as const) {
    const cur = current[k] ?? 0, rec = recorded[k] ?? 0;
    if (cur < rec - tol.readerPoints) out.push(`held-out ${k} ${cur}% is below the recorded ${rec}% minus ${tol.readerPoints} points`);
  }
  if ((current.authPrecision ?? 100) < (recorded.authPrecision ?? 100)) out.push(`held-out authorisation precision ${current.authPrecision}% fell below the recorded ${recorded.authPrecision}%`);
  if (current.entryFalsePositives > Math.max(1, recorded.entryFalsePositives)) out.push(`held-out entry-level false positives ${current.entryFalsePositives} (recorded ${recorded.entryFalsePositives}, spec max 1)`);
  return out;
}

